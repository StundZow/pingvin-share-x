// StundTransfer: unit tests for chunk storage (any order, grouped flushes, resume after a crash).
// Run with: npm run test:stundtransfer
import { strict as assert } from "assert";
import { randomBytes } from "crypto";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { ChunkStore, expectedChunkLength, totalChunks } from "../../src/stundtransfer/chunkStore";

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

  it("removing a deposit cancels its pending flush", async () => {
    const store = new ChunkStore(root, 50);
    await store.prepareDeposit("dep");
    await writeAll(store, randomBytes(4500), [0]);
    await store.removeDeposit("dep");
    await new Promise((resolve) => setTimeout(resolve, 200));
    await assert.rejects(fs.access(store.depositDir("dep")));
  });
});
