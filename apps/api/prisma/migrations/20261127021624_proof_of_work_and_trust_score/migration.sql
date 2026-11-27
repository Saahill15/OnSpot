-- CreateEnum
CREATE TYPE "PhotoKind" AS ENUM ('BEFORE', 'AFTER');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "arrivedAuto" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "arrivals" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cleanStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "onTimeArrivals" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "overchargeRefunds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "releases" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "JobPhoto" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" "PhotoKind" NOT NULL,
    "file" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobPhoto_jobId_idx" ON "JobPhoto"("jobId");

-- AddForeignKey
ALTER TABLE "JobPhoto" ADD CONSTRAINT "JobPhoto_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
