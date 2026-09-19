// StundTransfer: unit tests for the reliable move (never overwrite, never duplicate).
// Run with: npm run test:stundtransfer
import { strict as assert } from "assert";
import * as fsp from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  DestinationExistsError,
  MoveFs,
  moveIntoFolder,
  moveNoOverwrite,
} from "../../src/stundtransfer/safeMove";

let root: string;
let staging: string;
let transfer: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), "stund-move-"));
  staging = path.join(root, "en-cours");
  transfer = path.join(root, "transfer");
  await fsp.mkdir(staging);
  await fsp.mkdir(transfer);
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

async function stagedFile(name: string, content = "rush-data") {
  const file = path.join(staging, name);
  await fsp.writeFile(file, content);
  return { file, size: Buffer.byteLength(content) };
}

const exists = (p: string) =>
  fsp.access(p).then(
    () => true,
    () => false,
  );

function fsWith(overrides: Partial<MoveFs>): MoveFs {
  return { ...fsp, ...overrides } as MoveFs;
}

function errno(code: string) {
  return Object.assign(new Error(code), { code });
}

describe("moveNoOverwrite", () => {
  it("moves the file with a hard link (same mount)", async () => {
    const { file, size } = await stagedFile("a.mp4");
    const dest = path.join(transfer, "a.mp4");
    assert.equal(await moveNoOverwrite(file, dest, size), "link");
    assert.equal(await fsp.readFile(dest, "utf8"), "rush-data");
    assert.equal(await exists(file), false);
  });

  it("never overwrites an existing file", async () => {
    const { file, size } = await stagedFile("a.mp4");
    const dest = path.join(transfer, "a.mp4");
    await fsp.writeFile(dest, "already-here");
    await assert.rejects(moveNoOverwrite(file, dest, size), DestinationExistsError);
    assert.equal(await fsp.readFile(dest, "utf8"), "already-here");
    assert.equal(await exists(file), true);
  });

  it("falls back to copy + size check + delete when linking fails (EXDEV)", async () => {
    const { file, size } = await stagedFile("a.mp4");
    const dest = path.join(transfer, "a.mp4");
    const fs = fsWith({ link: async () => Promise.reject(errno("EXDEV")) });
    assert.equal(await moveNoOverwrite(file, dest, size, fs), "copy");
    assert.equal(await fsp.readFile(dest, "utf8"), "rush-data");
    assert.equal(await exists(file), false);
  });

  it("copy fallback also refuses to overwrite", async () => {
    const { file, size } = await stagedFile("a.mp4");
    const dest = path.join(transfer, "a.mp4");
    await fsp.writeFile(dest, "already-here");
    const fs = fsWith({ link: async () => Promise.reject(errno("EXDEV")) });
    await assert.rejects(moveNoOverwrite(file, dest, size, fs), DestinationExistsError);
    assert.equal(await fsp.readFile(dest, "utf8"), "already-here");
    assert.equal(await exists(file), true);
  });

  it("keeps the source and removes the copy if sizes differ", async () => {
    const { file, size } = await stagedFile("a.mp4");
    const dest = path.join(transfer, "a.mp4");
    const fs = fsWith({
      link: async () => Promise.reject(errno("EXDEV")),
      stat: (async (p: string) => ({ ...(await fsp.stat(p)), size: 1 })) as any,
    });
    await assert.rejects(moveNoOverwrite(file, dest, size, fs), /Size mismatch/);
    assert.equal(await exists(file), true);
    assert.equal(await exists(dest), false);
  });

  it("refuses an incomplete upload (declared size differs) and keeps the source", async () => {
    const { file } = await stagedFile("a.mp4");
    const dest = path.join(transfer, "a.mp4");
    await assert.rejects(moveNoOverwrite(file, dest, 999), /Size mismatch/);
    assert.equal(await exists(file), true);
    assert.equal(await exists(dest), false);
  });

  it("keeps the source and cleans up if the copy fails (disk full)", async () => {
    const { file, size } = await stagedFile("a.mp4");
    const dest = path.join(transfer, "a.mp4");
    const fs = fsWith({
      link: async () => Promise.reject(errno("EXDEV")),
      copyFile: async (_src, d) => {
        await fsp.writeFile(d as string, "partial");
        throw errno("ENOSPC");
      },
    });
    await assert.rejects(moveNoOverwrite(file, dest, size, fs), /ENOSPC/);
    assert.equal(await exists(file), true);
    assert.equal(await exists(dest), false);
  });

  it("never keeps two copies if the source cannot be deleted", async () => {
    for (const link of [
      undefined,
      async () => Promise.reject(errno("EXDEV")),
    ]) {
      const { file, size } = await stagedFile("a.mp4");
      const dest = path.join(transfer, "a.mp4");
      const fs = fsWith({
        ...(link ? { link } : {}),
        unlink: (async (p: string) => {
          if (p === file) throw errno("EACCES");
          return fsp.unlink(p);
        }) as any,
      });
      await assert.rejects(moveNoOverwrite(file, dest, size, fs), /EACCES/);
      assert.equal(await exists(file), true);
      assert.equal(await exists(dest), false);
      await fsp.unlink(file);
    }
  });
});

describe("moveIntoFolder", () => {
  it("creates sub-folders and keeps the original modification date", async () => {
    const { file, size } = await stagedFile("x.part");
    const mtime = new Date("2026-01-02T03:04:05Z");
    const { finalPath } = await moveIntoFolder({
      root: transfer,
      src: file,
      destDir: path.join(transfer, "Litsu - Beamng", "Card A", "CLIP"),
      fileName: "A001.MP4",
      expectedSize: size,
      mtime,
    });
    assert.equal(finalPath, path.join(transfer, "Litsu - Beamng", "Card A", "CLIP", "A001.MP4"));
    assert.equal((await fsp.stat(finalPath)).mtime.getTime(), mtime.getTime());
  });

  it('adds " (2)", " (3)" instead of overwriting', async () => {
    const folder = path.join(transfer, "Litsu - Beamng");
    await fsp.mkdir(folder);
    await fsp.writeFile(path.join(folder, "A001.MP4"), "first");
    await fsp.writeFile(path.join(folder, "A001 (2).MP4"), "second");

    const { file, size } = await stagedFile("x.part", "third");
    const { finalPath } = await moveIntoFolder({
      root: transfer,
      src: file,
      destDir: folder,
      fileName: "A001.MP4",
      expectedSize: size,
    });
    assert.equal(finalPath, path.join(folder, "A001 (3).MP4"));
    assert.equal(await fsp.readFile(path.join(folder, "A001.MP4"), "utf8"), "first");
    assert.equal(await fsp.readFile(path.join(folder, "A001 (2).MP4"), "utf8"), "second");
    assert.equal(await fsp.readFile(finalPath, "utf8"), "third");
  });

  it("refuses a destination outside the transfer folder", async () => {
    const { file, size } = await stagedFile("x.part");
    await assert.rejects(
      moveIntoFolder({
        root: transfer,
        src: file,
        destDir: path.join(root, "elsewhere"),
        fileName: "A001.MP4",
        expectedSize: size,
      }),
      /escapes/,
    );
    assert.equal(await exists(file), true);
    assert.equal(await exists(path.join(root, "elsewhere")), false);
  });

  it(
    "refuses a symlink pointing outside the transfer folder",
    { skip: process.platform === "win32" && "symlinks need admin rights on Windows" },
    async () => {
      const outside = path.join(root, "outside");
      await fsp.mkdir(outside);
      await fsp.symlink(outside, path.join(transfer, "evil"));
      const { file, size } = await stagedFile("x.part");
      await assert.rejects(
        moveIntoFolder({
          root: transfer,
          src: file,
          destDir: path.join(transfer, "evil"),
          fileName: "A001.MP4",
          expectedSize: size,
        }),
        /escapes/,
      );
      assert.equal(await exists(file), true);
      assert.deepEqual(await fsp.readdir(outside), []);
    },
  );
});
