// StundTransfer: settings that depend on the Docker volumes, read from environment
// variables (docker compose). Everything else is set in Admin > Configuration >
// StundTransfer (see the "stundtransfer" category in prisma/seed/config.seed.ts).
import * as path from "path";

function intFromEnv(name: string, fallback: number, min: number, max: number) {
  const value = parseInt(process.env[name] ?? "", 10);
  if (Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Final folder for received rushes. Deposit mode is disabled when empty. */
export const STUND_TRANSFER_DIR = process.env.STUNDTRANSFER_TRANSFER_DIR
  ? path.resolve(process.env.STUNDTRANSFER_TRANSFER_DIR)
  : "";

/**
 * Where chunks are written while uploading. Default: "en-cours" next to the
 * transfer folder. Keep it on the same Docker mount as the transfer folder so
 * the final move is an instant rename instead of a copy.
 */
export const STUND_STAGING_DIR = process.env.STUNDTRANSFER_STAGING_DIR
  ? path.resolve(process.env.STUNDTRANSFER_STAGING_DIR)
  : STUND_TRANSFER_DIR
    ? path.join(path.dirname(STUND_TRANSFER_DIR), "en-cours")
    : "";

/** Size of the chunks sent by browsers, in MB. 0 = use Pingvin's share.chunkSize. */
export const STUND_CHUNK_BYTES =
  intFromEnv("STUNDTRANSFER_CHUNK_MB", 0, 1, 256) * 1_000_000;
export const STUND_MIN_CHUNK_BYTES = 1_000_000;
export const STUND_MAX_CHUNK_BYTES = 256_000_000;

export const STUND_MAX_FILES = 20_000;
export const STUND_MAX_FILES_PER_BATCH = 250;

export const isStundTransferEnabled = () => STUND_TRANSFER_DIR !== "";
