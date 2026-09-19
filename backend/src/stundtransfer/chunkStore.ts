// StundTransfer: writes each uploaded chunk directly at its offset in the
// staging file, so chunks can arrive in any order and in parallel. A small
// append-only log of received chunk indexes makes uploads resumable.
// Pure module (no Nest/Prisma) so it can be unit-tested.
import { constants as fsConstants } from "fs";
import * as fs from "fs/promises";
import * as path from "path";

export function totalChunks(size: number, chunkSize: number) {
  // A 0-byte file is still sent as one (empty) chunk
  return Math.max(1, Math.ceil(size / chunkSize));
}

export function expectedChunkLength(
  size: number,
  chunkSize: number,
  index: number,
) {
  return Math.max(0, Math.min(chunkSize, size - index * chunkSize));
}

/** The chunk received does not have the expected length. */
export class ChunkLengthError extends Error {
  constructor() {
    super("Chunk length does not match");
  }
}

type FileState = {
  // Chunks written (durable or about to be flushed)
  received: Set<number>;
  // Chunks written but not yet flushed to disk and logged
  unflushed: Set<number>;
  timer?: ReturnType<typeof setTimeout>;
  flushing?: Promise<void>;
};

/**
 * Durability: a chunk is logged as received only after the data is flushed
 * to disk (fdatasync). Flushing after every chunk makes hard disks stall, so
 * flushes are grouped: every `flushDelayMs`, and always before a file is
 * reported complete. After a crash, unlogged chunks are simply sent again.
 */
export class ChunkStore {
  // "<depositId>/<fileId>" -> state (loaded once from the log)
  private files = new Map<string, Promise<FileState>>();

  constructor(
    private readonly root: string,
    private readonly flushDelayMs = 2000,
  ) {}

  depositDir(depositId: string) {
    return path.join(this.root, depositId);
  }

  dataPath(depositId: string, fileId: string) {
    return path.join(this.depositDir(depositId), `${fileId}.part`);
  }

  private logPath(depositId: string, fileId: string) {
    return path.join(this.depositDir(depositId), `${fileId}.chunks`);
  }

  async prepareDeposit(depositId: string) {
    await fs.mkdir(this.depositDir(depositId), { recursive: true });
  }

  private state(depositId: string, fileId: string): Promise<FileState> {
    const key = `${depositId}/${fileId}`;
    let state = this.files.get(key);
    if (!state) {
      state = this.loadLog(depositId, fileId).then((received) => ({
        received,
        unflushed: new Set<number>(),
      }));
      this.files.set(key, state);
      state.catch(() => this.files.delete(key));
    }
    return state;
  }

  private async loadLog(depositId: string, fileId: string) {
    try {
      const log = await fs.readFile(this.logPath(depositId, fileId), "utf8");
      return new Set(
        log
          .split("\n")
          .filter((line) => /^\d+$/.test(line))
          .map((line) => parseInt(line, 10)),
      );
    } catch (e) {
      if (e?.code === "ENOENT") return new Set<number>();
      throw e;
    }
  }

  async receivedChunks(depositId: string, fileId: string) {
    return (await this.state(depositId, fileId)).received;
  }

  /**
   * Writes `data` at `position`. Writing the same chunk twice (network retry)
   * is harmless. When the last missing chunk arrives, everything is flushed
   * before returning, so a complete file is always on disk.
   */
  async writeChunk(
    depositId: string,
    fileId: string,
    index: number,
    position: number,
    // A buffer, or a stream written to disk as it arrives (low memory use)
    data: Buffer | AsyncIterable<Buffer>,
    totalChunks: number,
    expectedLength: number = Buffer.isBuffer(data) ? data.length : 0,
  ): Promise<Set<number>> {
    // O_CREAT without O_TRUNC: parallel chunks never erase each other
    const handle = await fs.open(
      this.dataPath(depositId, fileId),
      fsConstants.O_WRONLY | fsConstants.O_CREAT,
      0o644,
    );
    let written = 0;
    const write = async (piece: Buffer) => {
      if (written + piece.length > expectedLength) throw new ChunkLengthError();
      let offset = 0;
      while (offset < piece.length) {
        const { bytesWritten } = await handle.write(
          piece,
          offset,
          piece.length - offset,
          position + written,
        );
        offset += bytesWritten;
        written += bytesWritten;
      }
    };
    try {
      if (Buffer.isBuffer(data)) await write(data);
      else for await (const piece of data) await write(piece);
    } finally {
      await handle.close();
    }
    // Incomplete chunk (connection cut): not recorded, it will be sent again
    if (written !== expectedLength) throw new ChunkLengthError();

    const state = await this.state(depositId, fileId);
    if (!state.received.has(index)) {
      state.received.add(index);
      state.unflushed.add(index);
    }

    if (state.received.size >= totalChunks) {
      await this.flush(depositId, fileId);
    } else if (!state.timer) {
      state.timer = setTimeout(() => {
        state.timer = undefined;
        this.flush(depositId, fileId).catch(() => undefined);
      }, this.flushDelayMs);
    }
    return state.received;
  }

  /** Flushes written chunks to disk, then logs them as received. */
  async flush(depositId: string, fileId: string) {
    const state = await this.state(depositId, fileId);
    // One flush at a time per file
    while (state.flushing) await state.flushing.catch(() => undefined);
    if (state.unflushed.size === 0) return;

    const indexes = [...state.unflushed];
    state.unflushed.clear();
    state.flushing = (async () => {
      try {
        const handle = await fs.open(this.dataPath(depositId, fileId), "r+");
        try {
          await handle.datasync();
        } finally {
          await handle.close();
        }
        await fs.appendFile(
          this.logPath(depositId, fileId),
          indexes.map((i) => `${i}\n`).join(""),
        );
      } catch (e) {
        // Not durable: forget these chunks so they are sent again
        indexes.forEach((i) => state.received.delete(i));
        throw e;
      } finally {
        state.flushing = undefined;
      }
    })();
    return state.flushing;
  }

  forgetDeposit(depositId: string) {
    for (const [key, state] of this.files) {
      if (!key.startsWith(`${depositId}/`)) continue;
      state.then((s) => clearTimeout(s.timer)).catch(() => undefined);
      this.files.delete(key);
    }
  }

  async removeDeposit(depositId: string) {
    this.forgetDeposit(depositId);
    await fs.rm(this.depositDir(depositId), { recursive: true, force: true });
  }
}
