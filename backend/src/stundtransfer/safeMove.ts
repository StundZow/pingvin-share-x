// StundTransfer: reliable "move without overwrite" used to put received files
// in their final folder. Pure module (no Nest/Prisma) so it can be unit-tested.
import { constants as fsConstants } from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { assertRealPathInside, candidateNames, resolveInside } from "./paths";

export type MoveFs = Pick<
  typeof fsp,
  "link" | "unlink" | "copyFile" | "stat" | "mkdir" | "utimes" | "rm" | "open"
>;

export class DestinationExistsError extends Error {}

// Errors meaning "hard links are not possible here" -> fall back to copying.
const LINK_UNSUPPORTED = new Set([
  "EXDEV",
  "EPERM",
  "ENOTSUP",
  "EOPNOTSUPP",
  "ENOSYS",
  "EMLINK",
]);

/**
 * Moves `src` to `dest`, never overwriting an existing `dest`.
 *
 * 1. Hard link + delete source: instant, atomic, fails if `dest` exists.
 * 2. If linking is impossible (e.g. EXDEV: different Docker mounts):
 *    exclusive copy -> flush to disk -> size check -> delete source.
 *
 * On failure the source file is always kept.
 */
export async function moveNoOverwrite(
  src: string,
  dest: string,
  expectedSize: number,
  fs: MoveFs = fsp,
): Promise<"link" | "copy"> {
  let linked = false;
  try {
    await fs.link(src, dest);
    linked = true;
  } catch (e) {
    if (e?.code === "EEXIST") throw new DestinationExistsError(dest);
    if (!LINK_UNSUPPORTED.has(e?.code)) throw e;
  }

  if (linked) {
    try {
      await assertSize(dest, expectedSize, fs);
      await fs.unlink(src);
    } catch (e) {
      // Back to the initial state: only the source exists.
      await fs.unlink(dest).catch(() => undefined);
      throw e;
    }
    return "link";
  }

  try {
    await fs.copyFile(
      src,
      dest,
      fsConstants.COPYFILE_EXCL | fsConstants.COPYFILE_FICLONE,
    );
  } catch (e) {
    if (e?.code === "EEXIST") throw new DestinationExistsError(dest);
    // The exclusive copy created `dest`: remove the partial copy.
    await fs.rm(dest, { force: true });
    throw e;
  }

  try {
    const handle = await fs.open(dest, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await assertSize(dest, expectedSize, fs);
  } catch (e) {
    await fs.rm(dest, { force: true });
    throw e;
  }

  try {
    await fs.unlink(src);
  } catch (e) {
    // Never keep the file twice: back to the initial state.
    await fs.rm(dest, { force: true });
    throw e;
  }
  return "copy";
}

async function assertSize(file: string, expectedSize: number, fs: MoveFs) {
  const { size } = await fs.stat(file);
  if (size !== expectedSize)
    throw new Error(
      `Size mismatch for ${path.basename(file)}: expected ${expectedSize} bytes, got ${size}`,
    );
}

/**
 * Moves `src` into `root/relativeDir/fileName`. If the name is taken, uses
 * "name (2).ext", "name (3).ext", ... Returns the final absolute path.
 */
export async function moveIntoFolder(options: {
  root: string;
  src: string;
  destDir: string;
  fileName: string;
  expectedSize: number;
  mtime?: Date;
  fs?: MoveFs;
}): Promise<{ finalPath: string; method: "link" | "copy" }> {
  const fs = options.fs ?? fsp;
  // Checked before creating anything, then again on the real path (symlinks).
  resolveInside(options.root, path.relative(options.root, options.destDir));
  await fs.mkdir(options.destDir, { recursive: true });
  await assertRealPathInside(options.root, options.destDir);

  for (const candidate of candidateNames(options.fileName)) {
    const dest = path.join(options.destDir, candidate);
    try {
      const method = await moveNoOverwrite(
        options.src,
        dest,
        options.expectedSize,
        fs,
      );
      if (options.mtime) {
        // Keep the original "date modified" (handy in Premiere). Not critical.
        await fs.utimes(dest, new Date(), options.mtime).catch(() => undefined);
      }
      return { finalPath: dest, method };
    } catch (e) {
      if (e instanceof DestinationExistsError) continue;
      throw e;
    }
  }
  throw new Error(`No free file name for ${options.fileName}`);
}
