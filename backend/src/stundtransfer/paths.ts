// StundTransfer: name sanitizing and path containment for deposits.
// Pure functions (no Nest/Prisma imports) so they can be unit-tested with `node --test`.
import * as fs from "fs/promises";
import * as path from "path";

// Characters forbidden on Windows/SMB, plus ASCII control characters.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[<>:"/\\|?*\x00-\x1f\x7f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;
// Names DSM uses for its own hidden folders.
const SYNOLOGY_RESERVED = new Set([
  "@eadir",
  "@tmp",
  "@sharebin",
  "#recycle",
  "#snapshot",
]);

// Stay well below the 255-byte filesystem limit.
export const MAX_SEGMENT_BYTES = 200;
export const MAX_DEPTH = 32;
export const MAX_NAME_FIELD_LENGTH = 60;

function truncateUtf8(value: string, maxBytes: number): string {
  let result = "";
  let bytes = 0;
  for (const char of value) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (bytes + charBytes > maxBytes) break;
    result += char;
    bytes += charBytes;
  }
  return result;
}

function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  // No extension, a leading dot, or something too long to be a real extension
  if (dot <= 0 || name.length - dot > 16) return [name, ""];
  return [name.slice(0, dot), name.slice(dot)];
}

function truncateKeepingExtension(name: string, maxBytes: number): string {
  if (Buffer.byteLength(name, "utf8") <= maxBytes) return name;
  const [base, ext] = splitExtension(name);
  const extBytes = Buffer.byteLength(ext, "utf8");
  if (extBytes >= maxBytes) return truncateUtf8(name, maxBytes);
  return truncateUtf8(base, maxBytes - extBytes) + ext;
}

/**
 * Turns any user-provided string into a single safe file or folder name.
 * Returns an empty string if nothing usable is left.
 */
export function sanitizeSegment(
  input: string,
  maxBytes = MAX_SEGMENT_BYTES,
): string {
  let name = (input ?? "").normalize("NFC");
  name = name.replace(/\s+/gu, " ");
  name = name.replace(FORBIDDEN_CHARS, "_");
  // No hidden files, no "." / ".." and no trailing dot or space (invalid on Windows)
  name = name.replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
  if (WINDOWS_RESERVED.test(name) || SYNOLOGY_RESERVED.has(name.toLowerCase()))
    name = `_${name}`;
  name = truncateKeepingExtension(name, maxBytes);
  return name.replace(/[.\s]+$/, "");
}

/**
 * Splits a relative path sent by the browser (e.g. "Card A/CLIP/A001.MP4")
 * into safe segments. "..", ".", empty and absolute parts are dropped.
 */
export function sanitizeRelativePath(input: string): string[] {
  const rawSegments = (input ?? "")
    .split(/[\\/]+/)
    .filter((s) => s !== "" && s !== "." && s !== "..");

  const fileName = sanitizeSegment(rawSegments.pop() ?? "") || "fichier";
  const folders = rawSegments
    .map((segment) => sanitizeSegment(segment))
    .filter((segment) => segment !== "")
    .slice(0, MAX_DEPTH - 1);

  return [...folders, fileName];
}

/** Cleans one of the "Qui es-tu ?" / "Pour quelle vidéo ?" fields. */
export function sanitizeNameField(input: string): string {
  const cleaned = sanitizeSegment(input);
  return Array.from(cleaned)
    .slice(0, MAX_NAME_FIELD_LENGTH)
    .join("")
    .replace(/[.\s]+$/, "");
}

/** "Litsu" + "Beamng" -> "Litsu - Beamng". Throws if a field is empty after cleaning. */
export function depositFolderName(uploader: string, video: string): string {
  const cleanUploader = sanitizeNameField(uploader);
  const cleanVideo = sanitizeNameField(video);
  if (!cleanUploader || !cleanVideo)
    throw new Error("Uploader name and video name are required");
  return `${cleanUploader} - ${cleanVideo}`;
}

/**
 * Resolves `segments` under `root` and guarantees the result stays strictly
 * inside `root` (path traversal protection).
 */
export function resolveInside(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, target);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(`Path escapes destination folder: ${segments.join("/")}`);
  return target;
}

/** Same check as resolveInside, on real paths (follows symlinks). */
export async function assertRealPathInside(root: string, target: string) {
  const [realRoot, realTarget] = await Promise.all([
    fs.realpath(root),
    fs.realpath(target),
  ]);
  const relative = path.relative(realRoot, realTarget);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(`Path escapes destination folder: ${target}`);
}

/** "clip.mp4" -> "clip.mp4", "clip (2).mp4", "clip (3).mp4", ... */
export function* candidateNames(fileName: string, max = 10000) {
  yield fileName;
  const [base, ext] = splitExtension(fileName);
  for (let i = 2; i <= max; i++) {
    const suffix = ` (${i})`;
    const room = MAX_SEGMENT_BYTES - Buffer.byteLength(suffix + ext, "utf8");
    yield `${truncateUtf8(base, room)}${suffix}${ext}`;
  }
}

/**
 * Returns the name of an existing folder in `root` matching `folderName`
 * case-insensitively ("litsu - beamng" reuses "Litsu - Beamng"), or `folderName`.
 */
export async function findExistingFolderName(
  root: string,
  folderName: string,
): Promise<string> {
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return folderName;
  }
  const directories = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (directories.includes(folderName)) return folderName;
  const wanted = folderName.normalize("NFC").toLowerCase();
  return (
    directories.find((name) => name.normalize("NFC").toLowerCase() === wanted) ??
    folderName
  );
}
