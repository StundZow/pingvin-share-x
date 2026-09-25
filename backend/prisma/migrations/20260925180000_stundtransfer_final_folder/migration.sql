-- StundTransfer: additive migration (new nullable column only)
-- AlterTable
ALTER TABLE "StundDeposit" ADD COLUMN "finalFolder" TEXT;

