import { buildApp } from "./app.js";
import { config } from "./config.js";
import { scanSkills, watchSkills } from "./skills/scanner.js";
import { reapOrphanRuns } from "./runner/reaper.js";
import { clearAllRetries, restorePendingRetries } from "./runner/scheduler.js";
import { startWorkspaceGc, stopWorkspaceGc } from "./runner/gc.js";
import { backupOnStartup } from "./backup/snapshot.js";
import { killActiveRuns } from "./runner/executor.js";

const app = await buildApp();

const skillsWatcher = watchSkills();

// Sin esto, parar la API deja vivos los `claude` que estuviera ejecutando: el
// reaper marcaría las filas como failed al rearrancar, pero los procesos
// seguirían gastando tokens sin nadie escuchándolos.
app.addHook("onClose", async () => {
  clearAllRetries();
  stopWorkspaceGc();
  await skillsWatcher.close();
  const killed = await killActiveRuns();
  if (killed > 0) app.log.info(`[shutdown] ${killed} run(s) activa(s) abortada(s)`);
});

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    app.log.info(`[shutdown] ${signal} recibida, cerrando…`);
    void app.close().then(() => process.exit(0));
  });
}

// Antes que nada: si algo de lo que viene a continuación deja la BD en mal
// estado, la copia es de justo antes.
await backupOnStartup();

const reaped = await reapOrphanRuns();
if (reaped > 0) {
  app.log.info(`[reaper] ${reaped} run(s) huérfana(s) marcadas como failed`);
}

const pendingRetries = await restorePendingRetries();
if (pendingRetries > 0) {
  app.log.info(`[scheduler] ${pendingRetries} run(s) esperando a que se reponga la cuota`);
}

const indexed = await scanSkills();
app.log.info(`[skills] ${indexed} SKILL.md indexados`);

// Barre los workspaces que ya no hacen falta: al arrancar y cada pocas horas.
startWorkspaceGc();

await app.listen({ port: config.port, host: config.host });
app.log.info(`API escuchando en http://${config.host}:${config.port}`);
