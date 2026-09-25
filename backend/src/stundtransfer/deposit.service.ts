// StundTransfer: deposit logic. Uploaders send their rushes through a reverse
// share link; files are written in the staging folder then moved to
// "<transfer>/<Nom> - <Vidéo>/". No Pingvin share (and no download link) is
// ever created for a deposit.
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { StundDeposit, StundDepositFile, User } from "@prisma/client";
import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as moment from "moment";
import * as path from "path";
import { validate as isValidUUID } from "uuid";
import { ConfigService } from "src/config/config.service";
import { PrismaService } from "src/prisma/prisma.service";
import { ReverseShareService } from "src/reverseShare/reverseShare.service";
import {
  ChunkLengthError,
  ChunkStore,
  expectedChunkLength,
  totalChunks,
} from "./chunkStore";
import { AddDepositFilesDTO, CreateDepositDTO } from "./dto/deposit.dto";
import {
  assertRealPathInside,
  depositFolderName,
  existingFolderNamesLowercase,
  findExistingFolderName,
  folderCandidates,
  resolveInside,
  sanitizeRelativePath,
  sanitizeSegment,
} from "./paths";
import { moveIntoFolder } from "./safeMove";
import {
  STUND_CHUNK_BYTES,
  STUND_DESTINATION_KEY,
  STUND_ROOT_DIR,
  STUND_ROOT_NAME,
  STUND_STAGING_DIR,
  isStundTransferEnabled,
} from "./stundtransfer.config";

const ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000;
const TOKEN_REGEX = /^[a-zA-Z0-9_-]{1,200}$/;

// Errors carry a stable "error" code the frontend translates.
function stundError(
  status: HttpStatus,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return new HttpException(
    { statusCode: status, error, message, ...extra },
    status,
  );
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

const ADMIN_DEPOSIT_FIELDS = {
  id: true,
  createdAt: true,
  lastActivityAt: true,
  completedAt: true,
  uploaderName: true,
  videoName: true,
  folderName: true,
  finalFolder: true,
  status: true,
  error: true,
  totalSize: true,
  fileCount: true,
  reverseShareId: true,
} as const;

@Injectable()
export class DepositService implements OnModuleInit {
  private readonly logger = new Logger("StundTransfer");
  private readonly chunks = new ChunkStore(STUND_STAGING_DIR);
  private moveQueue: Promise<void> = Promise.resolve();
  private lastActivityWrite = new Map<string, number>();
  private storageReady = false;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private reverseShareService: ReverseShareService,
  ) {}

  async onModuleInit() {
    if (!isStundTransferEnabled()) {
      this.logger.log(
        "Deposit mode disabled (STUNDTRANSFER_TRANSFER_DIR is not set)",
      );
      return;
    }

    try {
      const instantMoves = await this.checkStorage();
      this.storageReady = true;
      this.logger.log(
        `Deposit mode enabled. Mounted folder: ${STUND_ROOT_DIR} | destination: /${this.destinationRelative()} | uploads in progress: ${STUND_STAGING_DIR}`,
      );
      if (!instantMoves)
        this.logger.warn(
          "The transfer and staging folders are not on the same Docker mount: each file will be copied at the end of a deposit (slower, needs free space). Mount their parent folder once to get instant moves.",
        );
    } catch (e) {
      this.logger.error(
        `Deposit folders are not usable (${e.message}). Check the Docker volume and the folder permissions on the NAS.`,
      );
      return;
    }

    // Moves interrupted by a restart are resumed.
    const interrupted = await this.prisma.stundDeposit.findMany({
      where: { status: "MOVING" },
      select: { id: true },
    });
    interrupted.forEach(({ id }) => this.scheduleMove(id));
  }

  /** Creates both folders, checks they are writable and whether moves between them are instant. */
  private async checkStorage(): Promise<boolean> {
    await fs.mkdir(STUND_ROOT_DIR, { recursive: true });
    await fs.mkdir(STUND_STAGING_DIR, { recursive: true });

    const suffix = crypto.randomBytes(6).toString("hex");
    const probe = path.join(STUND_STAGING_DIR, `.probe-${suffix}`);
    const linked = path.join(STUND_ROOT_DIR, `.stundtransfer-probe-${suffix}`);
    await fs.writeFile(probe, "");
    try {
      await fs.writeFile(linked, "");
      await fs.rm(linked);
      await fs.link(probe, linked);
      await fs.rm(linked);
      return true;
    } catch (e) {
      if (["EXDEV", "EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"].includes(e?.code))
        return false;
      throw e;
    } finally {
      await fs.rm(probe, { force: true });
      await fs.rm(linked, { force: true });
    }
  }

  // Settings from Admin > Configuration > StundTransfer (read on each use: no restart needed)
  private publicDepositEnabled(): boolean {
    return this.config.get("stundtransfer.publicDeposit");
  }

  private parallelUploads(): number {
    return Math.min(16, Math.max(1, this.config.get("stundtransfer.parallelUploads") || 6));
  }

  private abandonAfterHours(): number {
    const { value, unit } = this.config.get("stundtransfer.abandonAfter");
    return Math.max(1, moment.duration(value, unit).asHours() || 72);
  }

  private chunkSize(requested?: number): number {
    return requested || STUND_CHUNK_BYTES || this.config.get("share.chunkSize");
  }

  private assertReady() {
    if (!isStundTransferEnabled())
      throw stundError(HttpStatus.NOT_FOUND, "stund_disabled", "Deposit mode is disabled");
    if (!this.storageReady)
      throw stundError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "stund_storage_unavailable",
        "The deposit folder is not available on the server",
      );
  }

  private async validLink(token: string) {
    if (
      !TOKEN_REGEX.test(token ?? "") ||
      !(await this.reverseShareService.isValid(token))
    )
      throw stundError(
        HttpStatus.NOT_FOUND,
        "stund_link_invalid",
        "This deposit link is invalid, expired or already used",
      );
    return this.reverseShareService.getByToken(token);
  }

  private async authorize(depositId: string, secret?: string) {
    const deposit = isValidUUID(depositId)
      ? await this.prisma.stundDeposit.findUnique({ where: { id: depositId } })
      : null;
    if (!deposit)
      throw stundError(HttpStatus.NOT_FOUND, "stund_not_found", "Deposit not found");

    const given = Buffer.from(sha256(secret ?? ""), "hex");
    const expected = Buffer.from(deposit.secretHash, "hex");
    if (
      !secret ||
      given.length !== expected.length ||
      !crypto.timingSafeEqual(given, expected)
    )
      throw stundError(HttpStatus.FORBIDDEN, "stund_forbidden", "Invalid deposit key");
    return deposit;
  }

  private assertUploading(deposit: StundDeposit) {
    if (deposit.status !== "UPLOADING")
      throw stundError(
        HttpStatus.CONFLICT,
        "stund_not_uploading",
        "This deposit is not accepting files anymore",
        { status: deposit.status },
      );
  }

  private async touch(depositId: string) {
    const now = Date.now();
    if (now - (this.lastActivityWrite.get(depositId) ?? 0) < ACTIVITY_WRITE_INTERVAL_MS)
      return;
    this.lastActivityWrite.set(depositId, now);
    await this.prisma.stundDeposit.update({
      where: { id: depositId },
      data: { lastActivityAt: new Date() },
    });
  }

  private async fileState(
    deposit: StundDeposit,
    file: Pick<StundDepositFile, "id" | "originalPath" | "size" | "status">,
  ) {
    const size = Number(file.size);
    const state = {
      id: file.id,
      path: file.originalPath,
      size,
      status: file.status,
      totalChunks: totalChunks(size, deposit.chunkSize),
      receivedChunks: undefined as number[] | undefined,
    };
    if (file.status === "UPLOADING" && deposit.status === "UPLOADING") {
      const received = await this.chunks.receivedChunks(deposit.id, file.id);
      state.receivedChunks = [...received].sort((a, b) => a - b);
    }
    return state;
  }

  // ---------------------------------------------------------------- uploader

  async getLinkInfo(token: string) {
    if (!isStundTransferEnabled()) return { depositMode: false };
    const reverseShare = await this.validLink(token);
    return {
      depositMode: true,
      maxSize: parseInt(reverseShare.maxShareSize),
      chunkSize: this.chunkSize(),
      parallelUploads: this.parallelUploads(),
    };
  }

  /** Public deposit on the home page (no link needed), if enabled by an admin. */
  async getPublicInfo() {
    if (!isStundTransferEnabled() || !this.publicDepositEnabled())
      return { depositMode: false };
    return {
      depositMode: true,
      maxSize: this.config.get("stundtransfer.maxDepositSize"),
      chunkSize: this.chunkSize(),
      parallelUploads: this.parallelUploads(),
    };
  }

  async createDeposit(dto: CreateDepositDTO) {
    this.assertReady();
    // With a deposit link: its limits apply. Without: the public deposit settings.
    let reverseShare: Awaited<ReturnType<DepositService["validLink"]>> | null = null;
    let maxSize: number;
    if (dto.token) {
      reverseShare = await this.validLink(dto.token);
      maxSize = parseInt(reverseShare.maxShareSize);
    } else if (this.publicDepositEnabled()) {
      maxSize = this.config.get("stundtransfer.maxDepositSize");
    } else {
      throw stundError(
        HttpStatus.NOT_FOUND,
        "stund_public_disabled",
        "Public deposit is disabled",
      );
    }

    let folderName: string;
    try {
      folderName = depositFolderName(dto.uploaderName, dto.videoName);
    } catch {
      throw stundError(
        HttpStatus.BAD_REQUEST,
        "stund_invalid_names",
        "Please fill in who you are and which video it is for",
      );
    }

    if (dto.totalSize > maxSize)
      throw stundError(
        HttpStatus.PAYLOAD_TOO_LARGE,
        "stund_too_large",
        `The files exceed the maximum size (${formatBytes(maxSize)})`,
        { maxSize },
      );

    const { bavail, bsize } = await fs.statfs(STUND_STAGING_DIR);
    if (bavail * bsize - dto.totalSize < this.config.get("stundtransfer.minFreeSpace"))
      throw stundError(
        HttpStatus.INSUFFICIENT_STORAGE,
        "stund_not_enough_space",
        "Not enough free space on the server for these files",
      );

    const secret = crypto.randomBytes(32).toString("base64url");
    const deposit = await this.prisma.stundDeposit.create({
      data: {
        uploaderName: dto.uploaderName.trim(),
        videoName: dto.videoName.trim(),
        folderName,
        secretHash: sha256(secret),
        totalSize: String(dto.totalSize),
        fileCount: dto.fileCount,
        chunkSize: this.chunkSize(dto.chunkSize),
        reverseShareId: reverseShare?.id ?? null,
        reverseShareOwnerId: reverseShare?.creatorId ?? null,
      },
    });
    await this.chunks.prepareDeposit(deposit.id);

    this.logger.log(
      `Deposit ${deposit.id} started: "${folderName}", ${dto.fileCount} file(s), ${formatBytes(dto.totalSize)}`,
    );

    return {
      depositId: deposit.id,
      secret,
      chunkSize: deposit.chunkSize,
      parallelUploads: this.parallelUploads(),
    };
  }

  async addFiles(depositId: string, secret: string, dto: AddDepositFilesDTO) {
    this.assertReady();
    const deposit = await this.authorize(depositId, secret);
    this.assertUploading(deposit);

    const paths = dto.files.map((f) => f.path);
    if (new Set(paths).size !== paths.length)
      throw stundError(
        HttpStatus.BAD_REQUEST,
        "stund_duplicate_path",
        "The same file was sent twice",
      );

    // Batches can be re-sent after a network error: known files are kept.
    const known = new Map(
      (
        await this.prisma.stundDepositFile.findMany({
          where: { depositId, originalPath: { in: paths } },
          select: { originalPath: true, size: true },
        })
      ).map((f) => [f.originalPath, f.size]),
    );
    for (const file of dto.files) {
      if (known.has(file.path) && known.get(file.path) !== String(file.size))
        throw stundError(
          HttpStatus.CONFLICT,
          "stund_duplicate_path",
          `"${file.path}" was already registered with another size`,
        );
    }
    const newFiles = dto.files.filter((f) => !known.has(f.path));

    const [totals] = await this.prisma.$queryRaw<
      { count: bigint | number; size: bigint | number | null }[]
    >`SELECT COUNT(*) AS count, SUM(CAST(size AS INTEGER)) AS size FROM StundDepositFile WHERE depositId = ${depositId}`;
    const registeredCount = Number(totals?.count ?? 0);
    const registeredSize = Number(totals?.size ?? 0);

    if (registeredCount + newFiles.length > deposit.fileCount)
      throw stundError(
        HttpStatus.BAD_REQUEST,
        "stund_too_many_files",
        "More files than announced",
      );
    const newSize = newFiles.reduce((sum, f) => sum + f.size, 0);
    if (registeredSize + newSize > Number(deposit.totalSize))
      throw stundError(
        HttpStatus.PAYLOAD_TOO_LARGE,
        "stund_too_large",
        "More data than announced",
      );

    if (newFiles.length > 0) {
      await this.prisma.stundDepositFile.createMany({
        data: newFiles.map((f) => {
          const lastModified =
            f.lastModified !== undefined ? new Date(f.lastModified) : null;
          return {
            depositId,
            originalPath: f.path,
            size: String(f.size),
            lastModified:
              lastModified && !isNaN(lastModified.getTime()) ? lastModified : null,
          };
        }),
      });
    }
    await this.touch(depositId);

    const files = await this.prisma.stundDepositFile.findMany({
      where: { depositId, originalPath: { in: paths } },
      select: { id: true, originalPath: true, size: true, status: true },
    });
    return {
      files: await Promise.all(files.map((f) => this.fileState(deposit, f))),
    };
  }

  /** State of a deposit, used by the uploader's browser to resume. */
  async getDeposit(depositId: string, secret: string) {
    const deposit = await this.authorize(depositId, secret);
    const files = await this.prisma.stundDepositFile.findMany({
      where: { depositId },
      select: { id: true, originalPath: true, size: true, status: true },
      orderBy: { createdAt: "asc" },
    });
    return {
      depositId: deposit.id,
      // The uploader only needs to know the upload is over
      status: deposit.status === "UPLOADING" ? "UPLOADING" : "RECEIVED",
      uploaderName: deposit.uploaderName,
      videoName: deposit.videoName,
      fileCount: deposit.fileCount,
      totalSize: Number(deposit.totalSize),
      chunkSize: deposit.chunkSize,
      parallelUploads: this.parallelUploads(),
      files: await Promise.all(files.map((f) => this.fileState(deposit, f))),
    };
  }

  async writeChunk(
    depositId: string,
    fileId: string,
    index: number,
    secret: string,
    // A buffer, or the request stream (written to disk as it arrives)
    data: Buffer | AsyncIterable<Buffer>,
    declaredLength?: number,
  ) {
    this.assertReady();
    const deposit = await this.authorize(depositId, secret);
    this.assertUploading(deposit);

    const file = isValidUUID(fileId)
      ? await this.prisma.stundDepositFile.findFirst({
          where: { id: fileId, depositId },
        })
      : null;
    if (!file)
      throw stundError(HttpStatus.NOT_FOUND, "stund_not_found", "File not found");

    const size = Number(file.size);
    const total = totalChunks(size, deposit.chunkSize);
    const expectedLength = expectedChunkLength(size, deposit.chunkSize, index);
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= total ||
      (Buffer.isBuffer(data) ? data.length : declaredLength) !== expectedLength
    )
      throw stundError(HttpStatus.BAD_REQUEST, "stund_bad_chunk", "Invalid chunk", {
        expectedLength,
      });

    if (file.status !== "UPLOADING") return { fileComplete: true };

    let received: Set<number>;
    try {
      received = await this.chunks.writeChunk(
        depositId,
        fileId,
        index,
        index * deposit.chunkSize,
        data,
        total,
        expectedLength,
      );
    } catch (e) {
      // Wrong length or connection cut during the chunk: it will be sent again
      if (
        e instanceof ChunkLengthError ||
        e?.code === "ECONNRESET" ||
        e?.code === "ERR_STREAM_PREMATURE_CLOSE" ||
        e?.message === "aborted"
      )
        throw stundError(HttpStatus.BAD_REQUEST, "stund_bad_chunk", "Incomplete chunk", {
          expectedLength,
        });
      if (e?.code === "ENOSPC")
        throw stundError(
          HttpStatus.INSUFFICIENT_STORAGE,
          "stund_not_enough_space",
          "The server is out of space",
        );
      this.logger.error(`Deposit ${depositId}: cannot write chunk: ${e.message}`);
      throw stundError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "stund_storage_error",
        "The server could not save this part of the file",
      );
    }

    const fileComplete = received.size >= total;
    if (fileComplete)
      await this.prisma.stundDepositFile.updateMany({
        where: { id: fileId, status: "UPLOADING" },
        data: { status: "UPLOADED" },
      });
    await this.touch(depositId);
    return { fileComplete };
  }

  async complete(depositId: string, secret: string) {
    const deposit = await this.authorize(depositId, secret);
    // Retried request: the uploader only needs to know it is received.
    if (["MOVING", "DONE", "ERROR"].includes(deposit.status))
      return { status: "RECEIVED" };
    this.assertUploading(deposit);

    const files = await this.prisma.stundDepositFile.findMany({
      where: { depositId },
      select: { id: true, status: true },
    });
    const missingFiles = files
      .filter((f) => f.status !== "UPLOADED")
      .map((f) => f.id);
    if (files.length !== deposit.fileCount || missingFiles.length > 0)
      throw stundError(
        HttpStatus.CONFLICT,
        "stund_incomplete",
        "Some files are not completely uploaded yet",
        { missingFiles, registered: files.length, expected: deposit.fileCount },
      );

    const { count } = await this.prisma.stundDeposit.updateMany({
      where: { id: depositId, status: "UPLOADING" },
      data: { status: "MOVING", completedAt: new Date() },
    });
    if (count === 1) {
      if (deposit.reverseShareId)
        await this.prisma.reverseShare.updateMany({
          where: { id: deposit.reverseShareId, remainingUses: { gt: 0 } },
          data: { remainingUses: { decrement: 1 } },
        });
      this.logger.log(
        `Deposit ${depositId} fully received (${files.length} file(s), ${formatBytes(Number(deposit.totalSize))})`,
      );
      this.scheduleMove(depositId);
    }
    return { status: "RECEIVED" };
  }

  /** The uploader cancels: files already sent are deleted from the staging folder. */
  async cancelByUploader(depositId: string, secret: string) {
    const deposit = await this.authorize(depositId, secret);
    this.assertUploading(deposit);
    await this.prisma.stundDeposit.update({
      where: { id: depositId },
      data: { status: "ABANDONED", error: "Cancelled by the uploader" },
    });
    await this.chunks.removeDeposit(depositId);
    this.lastActivityWrite.delete(depositId);
    this.logger.log(`Deposit ${depositId} cancelled by the uploader`);
  }

  // ------------------------------------------------------------- final move

  /** Moves run one at a time, so two deposits never race for the same names. */
  private scheduleMove(depositId: string) {
    this.moveQueue = this.moveQueue
      .then(() => this.moveDeposit(depositId))
      .catch(async (e) => {
        this.logger.error(`Deposit ${depositId}: move failed: ${e?.stack ?? e}`);
        await this.prisma.stundDeposit
          .update({
            where: { id: depositId },
            data: { status: "ERROR", error: String(e?.message ?? e).slice(0, 2000) },
          })
          .catch(() => undefined);
      });
  }

  /**
   * One new folder per deposit: "Litsu - Beamng", then "Litsu - Beamng (2)"...
   * (names compared without case, like Windows and SMB do). With the
   * "groupDeposits" setting, the existing folder is reused instead.
   */
  private async chooseFolder(folderName: string): Promise<string> {
    const destination = this.destinationRelative();
    const parent = this.folderPath(destination);
    await fs.mkdir(parent, { recursive: true });
    await assertRealPathInside(STUND_ROOT_DIR, parent);
    const relative = (name: string) => [destination, name].filter(Boolean).join("/");

    if (this.config.get("stundtransfer.groupDeposits"))
      return relative(await findExistingFolderName(parent, folderName));

    const taken = await existingFolderNamesLowercase(parent);
    for (const candidate of folderCandidates(folderName)) {
      if (taken.has(candidate.normalize("NFC").toLowerCase())) continue;
      try {
        // Not recursive: fails if the folder appeared meanwhile
        await fs.mkdir(resolveInside(parent, candidate));
        return relative(candidate);
      } catch (e) {
        if (e?.code !== "EEXIST") throw e;
      }
    }
    throw new Error(`No free folder name for "${folderName}"`);
  }

  // ------------------------------------------------- destination (admin)

  /** "A/B" -> ["A", "B"]; refuses "..", hidden and Synology system folders. */
  private folderParts(relative?: string): string[] {
    const parts = (relative ?? "")
      .split(/[\\/]+/)
      .filter((part) => part !== "" && part !== ".");
    if (parts.some((part) => part === ".." || /^[.@#]/.test(part)))
      throw stundError(HttpStatus.BAD_REQUEST, "stund_bad_folder", "Invalid folder");
    return parts;
  }

  /** Absolute path of a folder given relative to the mounted folder ("" = the mounted folder). */
  private folderPath(relative: string) {
    const parts = this.folderParts(relative);
    return parts.length ? resolveInside(STUND_ROOT_DIR, ...parts) : STUND_ROOT_DIR;
  }

  /** Destination chosen with the folder picker, relative to the mounted folder. */
  private destinationRelative(): string {
    try {
      return this.folderParts(this.config.get(STUND_DESTINATION_KEY) ?? "").join("/");
    } catch {
      this.logger.error("Invalid destination setting, using the mounted folder");
      return "";
    }
  }

  getDestination() {
    return {
      enabled: isStundTransferEnabled(),
      rootName: STUND_ROOT_NAME,
      destination: this.destinationRelative(),
    };
  }

  async listFolders(relative?: string) {
    this.assertReady();
    const parts = this.folderParts(relative);
    const dir = this.folderPath(parts.join("/"));
    let entries: import("fs").Dirent[];
    try {
      await assertRealPathInside(STUND_ROOT_DIR, dir);
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      throw stundError(HttpStatus.NOT_FOUND, "stund_folder_not_found", "Folder not found");
    }
    return {
      path: parts.join("/"),
      folders: entries
        .filter((e) => e.isDirectory() && !/^[.@#]/.test(e.name))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b, "fr", { numeric: true })),
    };
  }

  async createFolder(relative: string | undefined, name: string) {
    this.assertReady();
    const parts = this.folderParts(relative);
    const clean = sanitizeSegment(name);
    if (!clean || /^[.@#]/.test(clean))
      throw stundError(HttpStatus.BAD_REQUEST, "stund_bad_folder", "Invalid folder name");
    const parent = this.folderPath(parts.join("/"));
    await assertRealPathInside(STUND_ROOT_DIR, parent);
    await fs.mkdir(resolveInside(parent, clean), { recursive: true });
    return { path: [...parts, clean].join("/") };
  }

  async setDestination(relative: string | undefined, user: User) {
    this.assertReady();
    const parts = this.folderParts(relative);
    const dir = this.folderPath(parts.join("/"));
    try {
      await assertRealPathInside(STUND_ROOT_DIR, dir);
      if (!(await fs.stat(dir)).isDirectory()) throw new Error("not a folder");
    } catch {
      throw stundError(HttpStatus.NOT_FOUND, "stund_folder_not_found", "Folder not found");
    }
    await this.config.update(STUND_DESTINATION_KEY, parts.join("/"));
    this.logger.log(`Destination set to "/${parts.join("/")}" by ${user.username}`);
    return this.getDestination();
  }

  private async moveDeposit(depositId: string) {
    const deposit = await this.prisma.stundDeposit.findUnique({
      where: { id: depositId },
      include: { files: { orderBy: { createdAt: "asc" } } },
    });
    if (!deposit || deposit.status !== "MOVING") return;

    // The folder is chosen once, then reused if the move is retried or resumed
    let folder = deposit.finalFolder;
    if (!folder) {
      folder = await this.chooseFolder(deposit.folderName);
      await this.prisma.stundDeposit.update({
        where: { id: depositId },
        data: { finalFolder: folder },
      });
    }

    const failures: string[] = [];
    let copies = 0;
    for (const file of deposit.files) {
      if (file.status === "DONE") continue;
      try {
        const segments = sanitizeRelativePath(file.originalPath);
        const fileName = segments.pop();
        const destDir = resolveInside(STUND_ROOT_DIR, ...folder.split("/"), ...segments);
        const { finalPath, method } = await moveIntoFolder({
          root: STUND_ROOT_DIR,
          src: this.chunks.dataPath(depositId, file.id),
          destDir,
          fileName,
          expectedSize: Number(file.size),
          mtime: file.lastModified ?? undefined,
        });
        if (method === "copy") copies++;
        await this.prisma.stundDepositFile.update({
          where: { id: file.id },
          data: {
            status: "DONE",
            error: null,
            finalPath: path
              .relative(STUND_ROOT_DIR, finalPath)
              .split(path.sep)
              .join("/"),
          },
        });
      } catch (e) {
        const message = String(e?.message ?? e).slice(0, 1000);
        failures.push(`${file.originalPath}: ${message}`);
        this.logger.error(
          `Deposit ${depositId}: could not move "${file.originalPath}": ${message}`,
        );
        await this.prisma.stundDepositFile.update({
          where: { id: file.id },
          data: { status: "ERROR", error: message },
        });
      }
    }

    if (failures.length === 0) {
      await this.prisma.stundDeposit.update({
        where: { id: depositId },
        data: { status: "DONE", error: null },
      });
      await this.chunks.removeDeposit(depositId);
      this.lastActivityWrite.delete(depositId);
      this.logger.log(
        `Deposit ${depositId} stored in "${folder}" (${deposit.files.length} file(s)${copies ? `, ${copies} copied` : ""})`,
      );
    } else {
      await this.prisma.stundDeposit.update({
        where: { id: depositId },
        data: {
          status: "ERROR",
          error: `${failures.length} file(s) not moved. First error: ${failures[0]}`.slice(
            0,
            2000,
          ),
        },
      });
    }
  }

  // ------------------------------------------------------------------ admin

  private async getForAdmin(depositId: string, user: User) {
    const deposit = isValidUUID(depositId)
      ? await this.prisma.stundDeposit.findUnique({ where: { id: depositId } })
      : null;
    if (
      !deposit ||
      (!user.isAdmin && deposit.reverseShareOwnerId !== user.id)
    )
      throw stundError(HttpStatus.NOT_FOUND, "stund_not_found", "Deposit not found");
    return deposit;
  }

  async listForAdmin(user: User) {
    const deposits = await this.prisma.stundDeposit.findMany({
      where: user.isAdmin ? {} : { reverseShareOwnerId: user.id },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: ADMIN_DEPOSIT_FIELDS,
    });
    return deposits.map((d) => ({ ...d, totalSize: Number(d.totalSize) }));
  }

  async getForAdminWithFiles(depositId: string, user: User) {
    await this.getForAdmin(depositId, user);
    const deposit = await this.prisma.stundDeposit.findUnique({
      where: { id: depositId },
      select: {
        ...ADMIN_DEPOSIT_FIELDS,
        files: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            originalPath: true,
            size: true,
            status: true,
            finalPath: true,
            error: true,
          },
        },
      },
    });
    return {
      ...deposit,
      totalSize: Number(deposit.totalSize),
      files: deposit.files.map((f) => ({ ...f, size: Number(f.size) })),
    };
  }

  async retry(depositId: string, user: User) {
    this.assertReady();
    const deposit = await this.getForAdmin(depositId, user);
    if (deposit.status !== "ERROR")
      throw stundError(
        HttpStatus.CONFLICT,
        "stund_not_retryable",
        "Only deposits in error can be retried",
      );
    await this.prisma.stundDeposit.update({
      where: { id: depositId },
      data: { status: "MOVING", error: null },
    });
    this.scheduleMove(depositId);
  }

  /**
   * Unfinished or failed deposit: deletes its files waiting in the staging
   * folder. Finished deposit: removes it from the history. Files already in
   * the transfer folder are never touched.
   */
  async remove(depositId: string, user: User) {
    const deposit = await this.getForAdmin(depositId, user);
    if (deposit.status === "MOVING")
      throw stundError(
        HttpStatus.CONFLICT,
        "stund_busy",
        "This deposit is being moved, try again in a moment",
      );
    await this.chunks.removeDeposit(depositId);
    if (["UPLOADING", "ERROR"].includes(deposit.status)) {
      await this.prisma.stundDeposit.update({
        where: { id: depositId },
        data: { status: "ABANDONED", error: "Cancelled by the administrator" },
      });
    } else {
      await this.prisma.stundDeposit.delete({ where: { id: depositId } });
    }
  }

  // ---------------------------------------------------------------- cleanup

  @Cron("*/30 * * * *")
  async cleanupAbandonedDeposits() {
    if (!this.storageReady) return;
    const abandonAfterHours = this.abandonAfterHours();
    const cutoff = new Date(Date.now() - abandonAfterHours * 3600 * 1000);

    const stale = await this.prisma.stundDeposit.findMany({
      where: { status: "UPLOADING", lastActivityAt: { lt: cutoff } },
      select: { id: true },
    });
    for (const { id } of stale) {
      await this.chunks.removeDeposit(id);
      await this.prisma.stundDeposit.update({
        where: { id },
        data: {
          status: "ABANDONED",
          error: `No activity for ${Math.round(abandonAfterHours)} hours`,
        },
      });
      this.lastActivityWrite.delete(id);
    }

    // Leftover folders without an active deposit (e.g. manual database restore)
    let orphans = 0;
    const entries = await fs.readdir(STUND_STAGING_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidUUID(entry.name)) continue;
      const deposit = await this.prisma.stundDeposit.findUnique({
        where: { id: entry.name },
        select: { status: true },
      });
      if (deposit && ["UPLOADING", "MOVING", "ERROR"].includes(deposit.status))
        continue;
      const { mtime } = await fs.stat(path.join(STUND_STAGING_DIR, entry.name));
      if (mtime < cutoff) {
        await this.chunks.removeDeposit(entry.name);
        orphans++;
      }
    }

    if (stale.length + orphans > 0)
      this.logger.log(
        `Cleaned ${stale.length} abandoned deposit(s) and ${orphans} leftover folder(s)`,
      );
  }
}
