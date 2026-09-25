// StundTransfer: settings that depend on the Docker volumes, read from environment
// variables (docker compose). Everything else is set in Administration >
// Paramètres > StundTransfer (see the "stundtransfer" category in
// prisma/seed/config.seed.ts).
import * as path from "path";

function intFromEnv(name: string, fallback: number, min: number, max: number) {
  const value = parseInt(process.env[name] ?? "", 10);
  if (Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Folder of the NAS mounted in the container. The destination of the deposits
 * is chosen inside it from the admin page ("Dossier de réception"); by default
 * deposits land directly in it. STUNDTRANSFER_TRANSFER_DIR is the older name.
 * Deposit mode is disabled when empty.
 */
const rootFromEnv =
  process.env.STUNDTRANSFER_ROOT_DIR || process.env.STUNDTRANSFER_TRANSFER_DIR;
export const STUND_ROOT_DIR = rootFromEnv ? path.resolve(rootFromEnv) : "";

/** Name shown in the admin for the mounted folder (e.g. the Synology shared folder). */
export const STUND_ROOT_NAME =
  process.env.STUNDTRANSFER_ROOT_NAME ||
  (STUND_ROOT_DIR ? path.basename(STUND_ROOT_DIR) : "");

/**
 * Where chunks are written while uploading. Keep it on the same Synology shared
 * folder as the destination so the final move is an instant rename.
 */
export const STUND_STAGING_DIR = process.env.STUNDTRANSFER_STAGING_DIR
  ? path.resolve(process.env.STUNDTRANSFER_STAGING_DIR)
  : STUND_ROOT_DIR
    ? path.join(STUND_ROOT_DIR, ".stundtransfer-en-cours")
    : "";

/** Size of the chunks sent by browsers, in MB. 0 = use Pingvin's share.chunkSize. */
export const STUND_CHUNK_BYTES =
  intFromEnv("STUNDTRANSFER_CHUNK_MB", 0, 1, 256) * 1_000_000;
export const STUND_MIN_CHUNK_BYTES = 1_000_000;
export const STUND_MAX_CHUNK_BYTES = 256_000_000;

export const STUND_MAX_FILES = 20_000;
export const STUND_MAX_FILES_PER_BATCH = 250;

/** Setting holding the destination (path relative to STUND_ROOT_DIR, "" = root). */
export const STUND_DESTINATION_KEY = "stundtransferpaths.destination";

export const isStundTransferEnabled = () => STUND_ROOT_DIR !== "";
