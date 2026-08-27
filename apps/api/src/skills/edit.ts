import path from "node:path";
import matter from "gray-matter";

import { config } from "../config.js";
import { toPosix } from "../lib/paths.js";

/**
 * Guardar un SKILL.md desde la UI. Lo que se escribe acaba en el disco del
 * usuario y lo lee después un agente autónomo, así que hay dos guardas antes de
 * tocar nada: que el fichero esté donde decimos, y que el frontmatter no esté
 * roto.
 */

export class SkillEditError extends Error {}

/**
 * Un `filePath` sale de la BD, y la BD la puebla el scanner con rutas de
 * `SKILLS_PATHS` — pero una fila editada a mano o una ruta con `..` convertiría
 * este endpoint en un "escribe donde quieras" con permisos de la API.
 */
export function isInsideSkillsPaths(filePath: string, roots = config.skillsPaths): boolean {
  const target = toPosix(path.resolve(filePath)).toLowerCase();
  return roots.some((root) => {
    const base = toPosix(path.resolve(root)).toLowerCase();
    return target === base || target.startsWith(`${base}/`);
  });
}

/**
 * El scanner captura un frontmatter roto y sigue, así que guardar uno inválido
 * no rompe nada… pero deja la skill con los metadatos viejos y sin decírtelo.
 * Mejor negarse al guardar, que es cuando puedes arreglarlo.
 */
export function assertParseable(content: string): void {
  try {
    matter(content);
  } catch (err: any) {
    throw new SkillEditError(
      `El frontmatter no es YAML válido: ${String(err.message).split("\n")[0]}`,
    );
  }
}

/**
 * El nombre es la clave con la que el scanner hace upsert. Cambiarlo al guardar
 * no renombra la skill: crea otra y deja la vieja apuntando al mismo fichero.
 */
export function assertKeepsName(content: string, currentName: string): void {
  const { data } = matter(content);
  const next = data.name;
  if (next === undefined || next === null || next === currentName) return;

  throw new SkillEditError(
    `Esta skill se llama "${currentName}" y el frontmatter dice "${next}". Renombrar desde aquí dejaría dos entradas apuntando al mismo fichero: cambia el nombre en disco y vuelve a escanear.`,
  );
}
