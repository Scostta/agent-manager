import path from "node:path";

/**
 * Normaliza a estilo POSIX para comparaciones cross-platform.
 */
export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
