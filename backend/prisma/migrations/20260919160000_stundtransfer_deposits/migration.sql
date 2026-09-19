-- StundTransfer: additive migration (new tables only, nothing altered or dropped)
-- CreateTable
CREATE TABLE "StundDeposit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "uploaderName" TEXT NOT NULL,
    "videoName" TEXT NOT NULL,
    "folderName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "error" TEXT,
    "secretHash" TEXT NOT NULL,
    "totalSize" TEXT NOT NULL DEFAULT '0',
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "chunkSize" INTEGER NOT NULL,
    "reverseShareId" TEXT,
    "reverseShareOwnerId" TEXT
);

-- CreateTable
CREATE TABLE "StundDepositFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "depositId" TEXT NOT NULL,
    "originalPath" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "lastModified" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'UPLOADING',
    "finalPath" TEXT,
    "error" TEXT,
    CONSTRAINT "StundDepositFile_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "StundDeposit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StundDepositFile_depositId_originalPath_key" ON "StundDepositFile"("depositId", "originalPath");

