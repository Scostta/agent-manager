import { EventEmitter } from "node:events";

/**
 * Event bus global para comunicar el runner con los clientes SSE.
 * Los eventos se emiten con el topic `run:${taskRunId}` y los clientes
 * SSE se suscriben al topic de la run que están viendo.
 *
 * También emitimos `board` cuando cambia algo que afecta al kanban
 * (estado de task, creación, etc.) para que el frontend actualice.
 */
class Bus extends EventEmitter {}
export const bus = new Bus();
bus.setMaxListeners(100);

export type RunEvent =
  | { type: "stream"; data: unknown }
  | { type: "tokens"; input: number; output: number; cacheRead: number; costUsd: number }
  | { type: "status"; status: "running" | "succeeded" | "failed" | "cancelled" }
  | { type: "log"; line: string };

export type BoardEvent =
  | { type: "task_updated"; taskId: string }
  | { type: "task_created"; taskId: string }
  | { type: "task_deleted"; taskId: string };
