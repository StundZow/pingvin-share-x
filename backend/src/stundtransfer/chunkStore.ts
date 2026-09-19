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

export class ChunkStore {
  // "<depositId>/<fileId>" -> received chunk indexes (loaded once from the log)
  private received = new Map<string, Promise<Set<number>>>();

  constructor(private readonly root: string) {}

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

  receivedChunks(depositId: string, fileId: string): Promise<Set<number>> {
    const key = `${depositId}/${fileId}`;
    let received = this.received.get(key);
    if (!received) {
      received = this.loadLog(depositId, fileId);
      this.received.set(key, received);
      received.catch(() => this.received.delete(key));
    }
    return received;
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

  /**
   * Writes `data` at `position` and records chunk `index` once the data is on
   * disk. Writing the same chunk twice (network retry) is harmless.
   */
  async writeChunk(
    depositId: string,
    fileId: string,
    index: number,
    position: number,
    data: Buffer,
  ): Promise<Set<number>> {
    // O_CREAT without O_TRUNC: parallel chunks never erase each other
    const handle = await fs.open(
      this.dataPath(depositId, fileId),
      fsConstants.O_WRONLY | fsConstants.O_CREAT,
      0o644,
    );
    try {
      let written = 0;
      while (written < data.length) {
        const { bytesWritten } = await handle.write(
          data,
          written,
          data.length - written,
          position + written,
        );
        written += bytesWritten;
      }
      await handle.datasync();
    } finally {
      await handle.close();
    }

    const received = await this.receivedChunks(depositId, fileId);
    if (!received.has(index)) {
      await fs.appendFile(this.logPath(depositId, fileId), `${index}\n`);
      received.add(index);
    }
    return received;
  }

  forgetDeposit(depositId: string) {
    for (const key of this.received.keys()) {
      if (key.startsWith(`${depositId}/`)) this.received.delete(key);
    }
  }

  async removeDeposit(depositId: string) {
    this.forgetDeposit(depositId);
    await fs.rm(this.depositDir(depositId), { recursive: true, force: true });
  }
}
