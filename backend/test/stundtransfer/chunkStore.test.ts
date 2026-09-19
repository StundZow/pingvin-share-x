// StundTransfer: unit tests for chunk storage (any order, grouped flushes, resume after a crash).
// Run with: npm run test:stundtransfer
import { strict as assert } from "assert";
import { randomBytes } from "crypto";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Readable } from "stream";
import {
  ChunkLengthError,
  ChunkStore,
  expectedChunkLength,
  totalChunks,
} from "../../src/stundtransfer/chunkStore";

const CHUNK = 1000;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "stund-chunks-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeAll(store: ChunkStore, data: Buffer, order: number[]) {
  const total = totalChunks(data.length, CHUNK);
  for (const index of order) {
    const start = index * CHUNK;
    await store.writeChunk(
      "dep",
      "file",
      index,
      start,
      data.subarray(start, start + expectedChunkLength(data.length, CHUNK, index)),
      total,
    );
  }
}

describe("ChunkStore", () => {
  it("rebuilds the file from chunks received in any order", async () => {
    const store = new ChunkStore(root, 60000);
    await store.prepareDeposit("dep");
    const data = randomBytes(4500);
    await writeAll(store, data, [3, 0, 4, 2, 1, 2]);
    assert.deepEqual(await fs.readFile(store.dataPath("dep", "file")), data);
  });

  it("only remembers chunks after they are flushed to disk (crash safety)", async () => {
    const store = new ChunkStore(root, 60000);
    await store.prepareDeposit("dep");
    const data = randomBytes(4500);
    await writeAll(store, data, [0, 2]);
    assert.deepEqual([...(await store.receivedChunks("dep", "file"))].sort(), [0, 2]);

    // Simulated crash/restart before the flush: nothing is claimed as received
    const restarted = new ChunkStore(root, 60000);
    assert.equal((await restarted.receivedChunks("dep", "file")).size, 0);

    await store.flush("dep", "file");
    const afterFlush = new ChunkStore(root, 60000);
    assert.deepEqual([...(await afterFlush.receivedChunks("dep", "file"))].sort(), [0, 2]);
    store.forgetDeposit("dep");
  });

  it("flushes by itself after the delay", async () => {
    const store = new ChunkStore(root, 50);
    await store.prepareDeposit("dep");
    await writeAll(store, randomBytes(4500), [1]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const restarted = new ChunkStore(root, 50);
    assert.deepEqual([...(await restarted.receivedChunks("dep", "file"))], [1]);
  });

  it("flushes everything as soon as the last chunk arrives", async () => {
    const store = new ChunkStore(root, 60000);
    await store.prepareDeposit("dep");
    const data = randomBytes(4500);
    await writeAll(store, data, [4, 3, 2, 1, 0]);
    const restarted = new ChunkStore(root, 60000);
    assert.equal((await restarted.receivedChunks("dep", "file")).size, 5);
    assert.deepEqual(await fs.readFile(store.dataPath("dep", "file")), data);
  });

  it("handles an empty file (one empty chunk)", async () => {
    const store = new ChunkStore(root, 60000);
    await store.prepareDeposit("dep");
    await writeAll(store, Buffer.alloc(0), [0]);
    assert.equal((await fs.stat(store.dataPath("dep", "file"))).size, 0);
    const restarted = new ChunkStore(root, 60000);
    assert.deepEqual([...(await restarted.receivedChunks("dep", "file"))], [0]);
  });

  it("writes a streamed chunk as it arrives", async () => {
    const store = new ChunkStore(root, 60000);
    await store.prepareDeposit("dep");
    const data = randomBytes(2500);
    const pieces = [data.subarray(0, 700), data.subarray(700, 1000)];
    await store.writeChunk("dep", "file", 0, 0, Readable.from(pieces), 3, 1000);
    await store.writeChunk("dep", "file", 2, 2000, Readable.from([data.subarray(2000)]), 3, 500);
    await store.writeChunk("dep", "file", 1, 1000, Readable.from([data.subarray(1000, 2000)]), 3, 1000);
    assert.deepEqual(await fs.readFile(store.dataPath("dep", "file")), data);
    assert.equal((await new ChunkStore(root).receivedChunks("dep", "file")).size, 3);
  });

  it("groups a big streamed chunk arriving in small pieces into large writes", async () => {
    const store = new ChunkStore(root, 60000);
    await store.prepareDeposit("dep");
    const data = randomBytes(20_000_000);
    const pieces: Buffer[] = [];
    for (let o = 0; o < data.length; o += 65536) pieces.push(data.subarray(o, o + 65536));
    await store.writeChunk("dep", "file", 0, 0, Readable.from(pieces), 1, data.length);
    assert.deepEqual(await fs.readFile(store.dataPath("dep", "file")), data);
  });

  it("rejects a streamed chunk that is too long or cut short, without recording it", async () => {
    const store = new ChunkStore(root, 60000);
    await store.prepareDeposit("dep");
    await assert.rejects(
      store.writeChunk("dep", "file", 0, 0, Readable.from([randomBytes(1200)]), 3, 1000),
      ChunkLengthError,
    );
    await assert.rejects(
      store.writeChunk("dep", "file", 0, 0, Readable.from([randomBytes(400)]), 3, 1000),
      ChunkLengthError,
    );
    async function* cutConnection() {
      yield randomBytes(300);
      throw Object.assign(new Error("aborted"), { code: "ECONNRESET" });
    }
    await assert.rejects(store.writeChunk("dep", "file", 1, 1000, cutConnection(), 3, 1000));
    assert.equal((await store.receivedChunks("dep", "file")).size, 0);
  });

  it("removing a deposit cancels its pending flush", async () => {
    const store = new ChunkStore(root, 50);
    await store.prepareDeposit("dep");
    await writeAll(store, randomBytes(4500), [0]);
    await store.removeDeposit("dep");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await assert.rejects(fs.access(store.depositDir("dep")));
  });
});
