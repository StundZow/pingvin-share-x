// StundTransfer: settings read from environment variables (docker compose).
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

/** Chunks sent at the same time by each uploader's browser. */
export const STUND_PARALLEL_UPLOADS = intFromEnv(
  "STUNDTRANSFER_PARALLEL_UPLOADS",
  4,
  1,
  16,
);

/** A deposit is refused if it would leave less free space than this. */
export const STUND_MIN_FREE_BYTES =
  intFromEnv("STUNDTRANSFER_MIN_FREE_GB", 20, 0, 1_000_000) * 1_000_000_000;

/** Unfinished deposits are deleted after this many hours without activity. */
export const STUND_ABANDON_AFTER_HOURS = intFromEnv(
  "STUNDTRANSFER_ABANDON_AFTER_HOURS",
  72,
  1,
  24 * 365,
);

export const STUND_MAX_FILES = 20_000;
export const STUND_MAX_FILES_PER_BATCH = 250;

export const isStundTransferEnabled = () => STUND_TRANSFER_DIR !== "";
