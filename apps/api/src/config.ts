import path from "node:path";
import os from "node:os";

function expand(p: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  workspacesRoot: expand(process.env.WORKSPACES_ROOT ?? "./workspaces"),
  logsRoot: expand(process.env.LOGS_ROOT ?? "./logs"),
  skillsPaths: (process.env.SKILLS_PATHS ?? "./skills")
    .split(",")
    .map((p) => expand(p.trim()))
    .filter(Boolean),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  claudeCli: process.env.CLAUDE_CLI ?? "claude",
};
