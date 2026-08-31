import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

/**
 * Arnés de los tests que necesitan BD: monta una SQLite temporal y apunta ahí
 * todas las rutas de `config`.
 *
 * ORDEN DE IMPORTS: este módulo tiene que ser el PRIMER import del fichero de
 * test. En ESM los módulos se evalúan en el orden en que se importan, y tanto
 * `config.ts` como `db.ts` leen el entorno al cargarse: si `db.ts` se evalúa
 * antes que esto, el PrismaClient se conecta al `dev.db` de verdad y los tests
 * borran datos reales. Por lo mismo, aquí no se importa nada del `src/` de la
 * app en el nivel superior — solo con `await import()` desde las funciones.
 *
 * El esquema se aplica leyendo los `migration.sql` de Prisma con `node:sqlite`
 * (integrado en Node, sin dependencias nuevas). Lanzar el CLI de Prisma por
 * cada fichero de test costaba segundos y aquí no aporta nada: no se prueban
 * las migraciones, se prueba el código que corre encima.
 */

export const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-test-"));

export const TEST_DB_PATH = path.join(TEST_ROOT, "test.db");
export const SKILLS_DIR = path.join(TEST_ROOT, "skills");
export const WORKSPACES_DIR = path.join(TEST_ROOT, "workspaces");
export const LOGS_DIR = path.join(TEST_ROOT, "logs");
/** Carpeta libre para lo que cada test necesite crear en disco. */
export const SCRATCH_DIR = path.join(TEST_ROOT, "scratch");

for (const dir of [SKILLS_DIR, WORKSPACES_DIR, LOGS_DIR, SCRATCH_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
// Las dos: SKILLS_ROOT es donde escribe el alta desde la UI, y si se dejara
// al default (./skills, relativo al cwd) un test crearía skills en la carpeta
// real del usuario.
process.env.SKILLS_ROOT = SKILLS_DIR;
process.env.SKILLS_PATHS = SKILLS_DIR;
process.env.WORKSPACES_ROOT = WORKSPACES_DIR;
process.env.LOGS_ROOT = LOGS_DIR;
// Un binario que no existe: ningún test debe llegar a spawnear el CLI de
// verdad, y si alguno lo intenta el ENOENT lo deja claro en vez de gastar.
process.env.CLAUDE_CLI = "claude-cli-inexistente-de-test";
process.env.AUTH_MODE = "api_key";
process.env.QUEUE_CONCURRENCY = "1";
// Sin esto el GC de workspaces montaría su intervalo y el proceso de test no
// terminaría nunca.
process.env.WORKSPACE_GC_INTERVAL_HOURS = "0";

applyMigrations();

function applyMigrations(): void {
  // Relativo a este fichero, no al cwd: así da igual desde dónde se lancen.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.resolve(here, "..", "..", "prisma", "migrations");

  const migrations = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (!migrations.length) {
    throw new Error(`No hay migraciones en ${migrationsDir}`);
  }

  const sqlite = new DatabaseSync(TEST_DB_PATH);
  try {
    for (const migration of migrations) {
      const sqlPath = path.join(migrationsDir, migration, "migration.sql");
      if (!fs.existsSync(sqlPath)) continue;
      sqlite.exec(fs.readFileSync(sqlPath, "utf8"));
    }
  } finally {
    sqlite.close();
  }
}

/**
 * Red de seguridad: si por un orden de imports equivocado el cliente acabara
 * apuntando al `dev.db` real, mejor reventar que borrar los datos del usuario.
 */
export function assertUsingTestDb(databaseUrl: string): void {
  if (databaseUrl !== `file:${TEST_DB_PATH}`) {
    throw new Error(
      `Los tests están apuntando a ${databaseUrl} en vez de a la BD temporal. ` +
        "¿Se ha importado harness.js después de db.js o config.js?",
    );
  }
}

/** Deja la BD vacía entre tests sin volver a aplicar el esquema. */
export async function resetDb(): Promise<void> {
  const { db } = await import("../db.js");
  // El orden importa: las FK de SQLite no borran en cascada por sí solas.
  await db.taskRun.deleteMany();
  await db.task.deleteMany();
  await db.agentSkill.deleteMany();
  await db.agent.deleteMany();
  await db.skill.deleteMany();
  await db.project.deleteMany();
  await db.claudeMd.deleteMany();
}

export async function closeDb(): Promise<void> {
  const { db } = await import("../db.js");
  await db.$disconnect();
}

/** Carpeta vacía dentro del scratch, con nombre único. */
export function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(SCRATCH_DIR, `${prefix}-`));
}

// Windows mantiene el fichero de la BD abierto hasta que el proceso muere, así
// que el borrado es best-effort: lo que quede lo barre el sistema.
process.on("exit", () => {
  try {
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  } catch {
    /* el temp del sistema se limpia solo */
  }
});
