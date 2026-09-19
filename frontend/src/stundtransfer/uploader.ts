// StundTransfer: upload engine. Sends several chunks at the same time, retries
// forever with an increasing delay on network errors, and reports progress,
// speed and time left.
import { AxiosError } from "axios";
import stundTransferService, { DepositSession } from "./stundtransfer.service";

export type UploadItem = {
  id: string;
  file: File;
  path: string;
  size: number;
  totalChunks: number;
  received: Set<number>;
};

export type UploadProgress = {
  totalBytes: number;
  sentBytes: number;
  bytesPerSecond: number;
  secondsLeft?: number;
  filesDone: number;
  filesTotal: number;
  reconnecting: boolean;
};

/** Stops the upload for good (the page shows the translated error). */
export class FatalUploadError extends Error {
  constructor(
    public code: string,
    public values: Record<string, string> = {},
  ) {
    super(code);
  }
}

// Abort a chunk when nothing moved for this long
const STALL_TIMEOUT_MS = 30 * 1000;
// Show "connection lost" when nothing moved for this long
const QUIET_WARNING_MS = 10 * 1000;
const MAX_RETRY_DELAY_MS = 30 * 1000;
const SPEED_WINDOW_MS = 10 * 1000;
// HTTP statuses that will not get better by retrying
const FATAL_STATUSES = [400, 401, 403, 404, 409, 413, 507];

export const chunkLength = (size: number, chunkSize: number, index: number) =>
  Math.max(0, Math.min(chunkSize, size - index * chunkSize));

export function toFatalError(e: unknown): FatalUploadError | undefined {
  if (e instanceof FatalUploadError) return e;
  const response = (e as AxiosError<{ error?: string }>)?.response;
  if (response && FATAL_STATUSES.includes(response.status))
    return new FatalUploadError(response.data?.error ?? "unknown");
  return undefined;
}

export class DepositUploader {
  private queue: { item: UploadItem; index: number }[] = [];
  private inFlight = new Map<string, number>();
  private controllers = new Set<AbortController>();
  private confirmedBytes = 0;
  private samples: { time: number; bytes: number }[] = [];
  private stopped = false;
  private waitingRetries = 0;
  private wakeUps = new Set<() => void>();
  private concurrency: number;
  private consecutiveStalls = 0;
  private activeRequests = 0;
  private lastProgressAt = Date.now();
  private ticker?: ReturnType<typeof setInterval>;

  constructor(
    private session: DepositSession,
    private items: UploadItem[],
    private onProgress: (progress: UploadProgress) => void,
  ) {
    this.concurrency = session.parallelUploads;
  }

  async run() {
    for (const item of this.items) {
      for (let index = 0; index < item.totalChunks; index++) {
        if (item.received.has(index))
          this.confirmedBytes += chunkLength(item.size, this.session.chunkSize, index);
        else this.queue.push({ item, index });
      }
    }

    window.addEventListener("online", this.retryNow);
    this.ticker = setInterval(() => this.emit(), 500);
    try {
      await Promise.all(
        Array.from({ length: this.session.parallelUploads }, (_, n) =>
          this.worker(n),
        ),
      );
    } finally {
      this.stop();
    }
    this.emit();
  }

  stop() {
    this.stopped = true;
    this.controllers.forEach((controller) => controller.abort());
    window.removeEventListener("online", this.retryNow);
    clearInterval(this.ticker);
    this.retryNow();
  }

  /** Wakes up chunks waiting before a retry (e.g. the network is back). */
  private retryNow = () => {
    this.wakeUps.forEach((wakeUp) => wakeUp());
    this.wakeUps.clear();
  };

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      const self = this.wakeUps;
      function done() {
        clearTimeout(timer);
        self.delete(done);
        resolve();
      }
      self.add(done);
    });
  }

  private async worker(n: number) {
    while (!this.stopped) {
      // Very slow connection: some workers stop to give the others more bandwidth
      if (n >= this.concurrency) return;
      const job = this.queue.shift();
      if (!job) return;
      await this.uploadWithRetry(job.item, job.index);
    }
  }

  private async uploadWithRetry(item: UploadItem, index: number) {
    let attempt = 0;
    while (!this.stopped) {
      try {
        await this.uploadOnce(item, index);
        this.consecutiveStalls = 0;
        return;
      } catch (e) {
        const fatal = toFatalError(e);
        if (fatal) {
          this.stopped = true;
          throw fatal;
        }
        if ((e as Error)?.name === "StallError") {
          this.consecutiveStalls++;
          if (this.consecutiveStalls >= 2 && this.concurrency > 1) {
            this.concurrency--;
            this.consecutiveStalls = 0;
          }
        }
        attempt++;
        this.waitingRetries++;
        this.emit();
        await this.sleep(Math.min(MAX_RETRY_DELAY_MS, 1000 * 2 ** Math.min(attempt - 1, 5)));
        this.waitingRetries--;
      }
    }
  }

  private async uploadOnce(item: UploadItem, index: number) {
    const start = index * this.session.chunkSize;
    const length = chunkLength(item.size, this.session.chunkSize, index);

    // Read the chunk first: a file that became unreadable (unplugged drive)
    // is reported instead of being retried forever.
    let data: ArrayBuffer;
    try {
      data = await item.file.slice(start, start + length).arrayBuffer();
    } catch {
      throw new FatalUploadError("file-read", { name: item.path });
    }

    const key = `${item.id}:${index}`;
    const controller = new AbortController();
    this.controllers.add(controller);
    let lastActivity = Date.now();
    let stalled = false;
    const watchdog = setInterval(() => {
      if (Date.now() - lastActivity > STALL_TIMEOUT_MS) {
        stalled = true;
        controller.abort();
      }
    }, 5000);

    this.activeRequests++;
    try {
      await stundTransferService.uploadChunk(this.session, item.id, index, data, {
        signal: controller.signal,
        onUploadProgress: (event) => {
          lastActivity = Date.now();
          this.lastProgressAt = lastActivity;
          this.inFlight.set(key, event.loaded);
        },
      });
      item.received.add(index);
      this.confirmedBytes += length;
      this.lastProgressAt = Date.now();
    } catch (e) {
      if (stalled) {
        const stallError = new Error("Upload stalled");
        stallError.name = "StallError";
        throw stallError;
      }
      throw e;
    } finally {
      clearInterval(watchdog);
      this.activeRequests--;
      this.controllers.delete(controller);
      this.inFlight.delete(key);
    }
  }

  private emit() {
    const totalBytes = this.items.reduce((sum, item) => sum + item.size, 0);
    let inFlightBytes = 0;
    this.inFlight.forEach((bytes) => (inFlightBytes += bytes));
    const sentBytes = Math.min(totalBytes, this.confirmedBytes + inFlightBytes);

    const now = Date.now();
    this.samples.push({ time: now, bytes: sentBytes });
    while (this.samples.length > 2 && now - this.samples[0].time > SPEED_WINDOW_MS)
      this.samples.shift();
    const oldest = this.samples[0];
    const elapsed = (now - oldest.time) / 1000;
    const bytesPerSecond = elapsed > 0.5 ? Math.max(0, (sentBytes - oldest.bytes) / elapsed) : 0;

    this.onProgress({
      totalBytes,
      sentBytes,
      bytesPerSecond,
      secondsLeft:
        bytesPerSecond > 0 ? (totalBytes - sentBytes) / bytesPerSecond : undefined,
      filesDone: this.items.filter((i) => i.received.size >= i.totalChunks).length,
      filesTotal: this.items.length,
      reconnecting:
        this.waitingRetries > 0 ||
        navigator.onLine === false ||
        (this.activeRequests > 0 && now - this.lastProgressAt > QUIET_WARNING_MS),
    });
  }
}
