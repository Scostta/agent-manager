-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TaskRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "workspacePath" TEXT NOT NULL,
    "branchName" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" REAL NOT NULL DEFAULT 0,
    "logPath" TEXT NOT NULL,
    "resultSummary" TEXT,
    "pid" INTEGER,
    "failureKind" TEXT,
    "rateLimitResetAt" DATETIME,
    "sessionId" TEXT,
    "resumedFromId" TEXT,
    "followUpPrompt" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "TaskRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TaskRun_resumedFromId_fkey" FOREIGN KEY ("resumedFromId") REFERENCES "TaskRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TaskRun" ("agentId", "branchName", "cacheReadTokens", "cacheWriteTokens", "costUsd", "endedAt", "failureKind", "id", "inputTokens", "logPath", "outputTokens", "pid", "rateLimitResetAt", "resultSummary", "startedAt", "status", "taskId", "workspacePath") SELECT "agentId", "branchName", "cacheReadTokens", "cacheWriteTokens", "costUsd", "endedAt", "failureKind", "id", "inputTokens", "logPath", "outputTokens", "pid", "rateLimitResetAt", "resultSummary", "startedAt", "status", "taskId", "workspacePath" FROM "TaskRun";
DROP TABLE "TaskRun";
ALTER TABLE "new_TaskRun" RENAME TO "TaskRun";
CREATE INDEX "TaskRun_taskId_idx" ON "TaskRun"("taskId");
CREATE INDEX "TaskRun_status_idx" ON "TaskRun"("status");
CREATE INDEX "TaskRun_resumedFromId_idx" ON "TaskRun"("resumedFromId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
