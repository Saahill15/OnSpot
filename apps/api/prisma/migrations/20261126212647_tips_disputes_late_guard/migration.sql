-- CreateEnum
CREATE TYPE "DisputeReason" AS ENUM ('OVERCHARGED', 'NO_SHOW', 'BAD_SERVICE', 'DAMAGE', 'SAFETY', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "lateAt" TIMESTAMP(3),
ADD COLUMN     "minRating" DOUBLE PRECISION,
ADD COLUMN     "promisedBy" TIMESTAMP(3),
ADD COLUMN     "tip" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "reason" "DisputeReason" NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "refundAmount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_jobId_key" ON "Dispute"("jobId");

-- CreateIndex
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
