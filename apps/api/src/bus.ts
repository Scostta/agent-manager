import { EventEmitter } from "node:events";

class Bus extends EventEmitter {}
export const bus = new Bus();
bus.setMaxListeners(100);

export type RunEvent =
  | { type: "stream"; data: unknown }
  | {
      type: "tokens";
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      costUsd: number;
    }
  | { type: "status"; status: "running" | "succeeded" | "failed" | "cancelled" }
  | { type: "log"; line: string };

/** Planificación de las tareas iniciales de un proyecto recién creado. */
export type PlanEvent =
  | { type: "stream"; data: unknown }
  | { type: "log"; line: string }
  | { type: "done"; cancelled: boolean };

export type BoardEvent =
  | { type: "task_updated"; taskId: string }
  | { type: "task_created"; taskId: string }
  | { type: "task_deleted"; taskId: string }
  /** Pausa, concurrencia o kill switch: la cabecera revalida su indicador. */
  | { type: "queue_changed" };
