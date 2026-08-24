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
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "TaskRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TaskRun" ("agentId", "branchName", "cacheReadTokens", "costUsd", "endedAt", "id", "inputTokens", "logPath", "outputTokens", "pid", "resultSummary", "startedAt", "status", "taskId", "workspacePath") SELECT "agentId", "branchName", "cacheReadTokens", "costUsd", "endedAt", "id", "inputTokens", "logPath", "outputTokens", "pid", "resultSummary", "startedAt", "status", "taskId", "workspacePath" FROM "TaskRun";
DROP TABLE "TaskRun";
ALTER TABLE "new_TaskRun" RENAME TO "TaskRun";
CREATE INDEX "TaskRun_taskId_idx" ON "TaskRun"("taskId");
CREATE INDEX "TaskRun_status_idx" ON "TaskRun"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
