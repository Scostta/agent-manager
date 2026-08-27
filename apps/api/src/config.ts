import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/**
 * Ni tsx ni node cargan `.env` por su cuenta. Prisma sí lo hace, pero al
 * construir el cliente: para entonces este módulo ya se ha evaluado y habría
 * cogido los defaults en silencio. Lo cargamos aquí, antes de leer nada.
 *
 * Todos los scripts de package.json corren con cwd = apps/api, así que el
 * fichero está siempre a un `.env` de distancia.
 */
function loadEnvFile(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    process.loadEnvFile(envPath);
  } catch (err) {
    console.warn(`[config] ${envPath} existe pero no se pudo parsear:`, err);
  }
}

loadEnvFile();

function expand(p: string): string {
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

function list(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  // Single-user en local: escuchar en 0.0.0.0 dejaría a cualquiera de la red
  // lanzar procesos `claude` con permisos de escritura sobre este disco.
  host: process.env.HOST ?? "127.0.0.1",
  corsOrigins: list(
    process.env.CORS_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000",
  ),
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  workspacesRoot: expand(process.env.WORKSPACES_ROOT ?? "./workspaces"),
  logsRoot: expand(process.env.LOGS_ROOT ?? "./logs"),
  skillsPaths: list(process.env.SKILLS_PATHS ?? "./skills").map(expand),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  claudeCli: process.env.CLAUDE_CLI ?? "claude",
  /**
   * "subscription": el CLI usa tu login de claude.ai y las runs consumen del
   * plan. "api_key": inyectamos ANTHROPIC_API_KEY y se facturan por API.
   * Una key presente en el entorno gana sobre el login, así que en modo
   * suscripción hay que quitarla del entorno del hijo, no basta con no ponerla.
   */
  authMode: (process.env.AUTH_MODE ?? "subscription") as "subscription" | "api_key",
  // Una run colgada ocupa un hueco de la cola para siempre. 0 = sin límite.
  runTimeoutMs: Number(process.env.RUN_TIMEOUT_MS ?? 30 * 60_000),
  // Modelo que propone las tareas iniciales al crear un proyecto. No edita
  // nada, solo lee y devuelve JSON, así que no hace falta el modelo más caro.
  plannerModel: process.env.PLANNER_MODEL ?? "claude-sonnet-5",
  // Más corto que runTimeoutMs: el usuario está esperando delante del formulario.
  planTimeoutMs: Number(process.env.PLAN_TIMEOUT_MS ?? 5 * 60_000),
  // Cuántos agentes pueden correr a la vez. Se puede cambiar en caliente desde
  // la UI; esto es solo el valor de arranque.
  queueConcurrency: Math.max(1, Number(process.env.QUEUE_CONCURRENCY ?? 2)),
  // Edad mínima para que el GC toque un workspace, y cada cuánto barre.
  workspaceGcDays: Math.max(0, Number(process.env.WORKSPACE_GC_DAYS ?? 7)),
  workspaceGcIntervalHours: Math.max(0, Number(process.env.WORKSPACE_GC_INTERVAL_HOURS ?? 6)),
  // Copias de la BD. Se hace una al arrancar y se conservan las N últimas;
  // 0 desactiva la copia automática (el endpoint de descarga sigue estando).
  backupsRoot: expand(process.env.BACKUPS_ROOT ?? "./backups"),
  backupKeep: Math.max(0, Number(process.env.BACKUP_KEEP ?? 5)),
};
