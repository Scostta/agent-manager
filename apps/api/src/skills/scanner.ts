import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import matter from "gray-matter";
import chokidar from "chokidar";

import { db } from "../db.js";
import { config } from "../config.js";
import { toPosix } from "../lib/paths.js";

async function findSkillFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(root, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".git")) continue;
        results.push(...(await findSkillFiles(full)));
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        results.push(full);
      }
    }
  } catch {
    // ruta no existe, ignoramos
  }
  return results;
}

async function hashFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Normaliza separadores para que funcione igual en Windows y Unix.
 */
function scopeFromPath(filePath: string): string {
  const normalized = toPosix(filePath);
  if (normalized.includes("/public/")) return "public";
  if (normalized.includes("/user/")) return "user";
  return "user";
}

async function upsertSkillFromFile(filePath: string): Promise<void> {
  const raw = await fs.readFile(filePath, "utf8");
  const { data } = matter(raw);
  const name = data.name ?? path.basename(path.dirname(filePath));
  const description = data.description ?? "";
  const tags = Array.isArray(data.tags) ? data.tags : [];
  const contentHash = await hashFile(filePath);

  await db.skill.upsert({
    where: { name },
    update: {
      description,
      filePath,
      contentHash,
      scope: scopeFromPath(filePath),
      tags: JSON.stringify(tags),
    },
    create: {
      name,
      description,
      filePath,
      contentHash,
      scope: scopeFromPath(filePath),
      tags: JSON.stringify(tags),
    },
  });
}

export async function scanSkills(): Promise<number> {
  let count = 0;
  for (const root of config.skillsPaths) {
    const files = await findSkillFiles(root);
    for (const file of files) {
      try {
        await upsertSkillFromFile(file);
        count++;
      } catch (err) {
        console.warn(`[skills] Error procesando ${file}:`, err);
      }
    }
  }
  return count;
}

export function watchSkills(): void {
  const watcher = chokidar.watch(
    config.skillsPaths.map((p) => path.join(p, "**/SKILL.md")),
    { ignoreInitial: true },
  );
  watcher.on("add", (p) => upsertSkillFromFile(p).catch(console.error));
  watcher.on("change", (p) => upsertSkillFromFile(p).catch(console.error));
  watcher.on("unlink", async (p) => {
    await db.skill.deleteMany({ where: { filePath: p } });
  });
}
