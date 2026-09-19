// StundTransfer: calls to the deposit API (backend/src/stundtransfer).
import { AxiosProgressEvent } from "axios";
import api from "../services/api.service";

const SECRET_HEADER = "x-deposit-secret";

export type LinkInfo = {
  depositMode: boolean;
  maxSize?: number;
  chunkSize?: number;
  parallelUploads?: number;
};

export type DepositSession = {
  depositId: string;
  secret: string;
  chunkSize: number;
  parallelUploads: number;
};

export type DepositFileState = {
  id: string;
  path: string;
  size: number;
  status: "UPLOADING" | "UPLOADED" | "DONE" | "ERROR";
  totalChunks: number;
  receivedChunks?: number[];
};

export type DepositState = {
  depositId: string;
  status: "UPLOADING" | "RECEIVED";
  uploaderName: string;
  videoName: string;
  fileCount: number;
  totalSize: number;
  chunkSize: number;
  parallelUploads: number;
  files: DepositFileState[];
};

export type AdminDeposit = {
  id: string;
  createdAt: string;
  lastActivityAt: string;
  completedAt?: string;
  uploaderName: string;
  videoName: string;
  folderName: string;
  status: "UPLOADING" | "MOVING" | "DONE" | "ERROR" | "ABANDONED";
  error?: string;
  totalSize: number;
  fileCount: number;
  files?: {
    id: string;
    originalPath: string;
    size: number;
    status: string;
    finalPath?: string;
    error?: string;
  }[];
};

const getGuestLink = async (): Promise<{ token: string }> =>
  (await api.get("stundtransfer/guest")).data;

const getLink = async (token: string): Promise<LinkInfo> =>
  (await api.get(`stundtransfer/links/${encodeURIComponent(token)}`)).data;

const createDeposit = async (body: {
  token: string;
  uploaderName: string;
  videoName: string;
  fileCount: number;
  totalSize: number;
}): Promise<DepositSession> =>
  (await api.post("stundtransfer/deposits", body)).data;

const addFiles = async (
  session: Pick<DepositSession, "depositId" | "secret">,
  files: { path: string; size: number; lastModified?: number }[],
): Promise<DepositFileState[]> =>
  (
    await api.post(
      `stundtransfer/deposits/${session.depositId}/files`,
      { files },
      { headers: { [SECRET_HEADER]: session.secret } },
    )
  ).data.files;

const getDeposit = async (
  session: Pick<DepositSession, "depositId" | "secret">,
): Promise<DepositState> =>
  (
    await api.get(`stundtransfer/deposits/${session.depositId}`, {
      headers: { [SECRET_HEADER]: session.secret },
    })
  ).data;

const uploadChunk = async (
  session: Pick<DepositSession, "depositId" | "secret">,
  fileId: string,
  index: number,
  data: ArrayBuffer,
  options: {
    signal: AbortSignal;
    onUploadProgress: (event: AxiosProgressEvent) => void;
  },
): Promise<{ fileComplete: boolean }> =>
  (
    await api.put(
      `stundtransfer/deposits/${session.depositId}/files/${fileId}/chunks/${index}`,
      data,
      {
        headers: {
          [SECRET_HEADER]: session.secret,
          // Measured faster on the NAS than "application/x-stundtransfer-chunk"
          // (streamed), which the server also accepts
          "Content-Type": "application/octet-stream",
        },
        signal: options.signal,
        onUploadProgress: options.onUploadProgress,
      },
    )
  ).data;

const complete = async (
  session: Pick<DepositSession, "depositId" | "secret">,
) =>
  (
    await api.post(
      `stundtransfer/deposits/${session.depositId}/complete`,
      {},
      { headers: { [SECRET_HEADER]: session.secret } },
    )
  ).data;

const cancelDeposit = async (
  session: Pick<DepositSession, "depositId" | "secret">,
) =>
  api.delete(`stundtransfer/deposits/${session.depositId}`, {
    headers: { [SECRET_HEADER]: session.secret },
  });

const listDeposits = async (): Promise<AdminDeposit[]> =>
  (await api.get("stundtransfer/admin/deposits")).data;

const getDepositDetails = async (id: string): Promise<AdminDeposit> =>
  (await api.get(`stundtransfer/admin/deposits/${id}`)).data;

const retryDeposit = async (id: string) =>
  api.post(`stundtransfer/admin/deposits/${id}/retry`);

const removeDeposit = async (id: string) =>
  api.delete(`stundtransfer/admin/deposits/${id}`);

export default {
  getGuestLink,
  getLink,
  createDeposit,
  addFiles,
  getDeposit,
  uploadChunk,
  complete,
  cancelDeposit,
  listDeposits,
  getDepositDetails,
  retryDeposit,
  removeDeposit,
};
