-- AlterTable
ALTER TABLE "TaskRun" ADD COLUMN "failureKind" TEXT;
ALTER TABLE "TaskRun" ADD COLUMN "rateLimitResetAt" DATETIME;
