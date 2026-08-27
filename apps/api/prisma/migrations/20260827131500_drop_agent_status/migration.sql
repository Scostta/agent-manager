-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "maxBudgetUsd" REAL,
    "allowedTools" TEXT,
    "disallowedTools" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Agent" ("allowedTools", "createdAt", "disallowedTools", "id", "maxBudgetUsd", "model", "name", "role", "systemPrompt", "updatedAt") SELECT "allowedTools", "createdAt", "disallowedTools", "id", "maxBudgetUsd", "model", "name", "role", "systemPrompt", "updatedAt" FROM "Agent";
DROP TABLE "Agent";
ALTER TABLE "new_Agent" RENAME TO "Agent";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
