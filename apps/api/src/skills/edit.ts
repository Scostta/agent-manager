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

/**
 * El nombre no es solo una etiqueta: es el nombre de la carpeta que se crea en
 * disco y, sobre todo, el del symlink que `injectWorkspaceResources` planta en
 * `.claude/skills/<name>` del workspace. Un "../.." ahí escribiría fuera del
 * workspace, así que se valida antes de dejar crear nada.
 *
 * Kebab-case porque es lo que espera el CLI y lo que ya usan las carpetas
 * existentes; el límite de 64 es para no chocar con MAX_PATH en Windows, donde
 * este nombre se concatena a la ruta ya larga del workspace.
 */
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function assertValidSkillName(name: string): void {
  if (!name) throw new SkillEditError("La skill necesita un nombre.");
  if (name.length > 64) {
    throw new SkillEditError("El nombre no puede pasar de 64 caracteres.");
  }
  if (!SKILL_NAME_RE.test(name)) {
    throw new SkillEditError(
      `"${name}" no vale como nombre: usa minúsculas, números y guiones (p.ej. "revisar-migraciones").`,
    );
  }
}

/**
 * El SKILL.md de partida. Lleva ya el frontmatter que el scanner necesita para
 * indexarla —sin `name` cogería el de la carpeta y sin `description` la ficha
 * saldría vacía— y un cuerpo mínimo que se edita después en el mismo Monaco.
 *
 * La descripción va por JSON.stringify: es texto libre del usuario y un `:` o
 * unas comillas sueltas romperían el YAML del frontmatter, que es justo lo que
 * `assertParseable` rechaza al guardar.
 */
export function skillTemplate(name: string, description: string): string {
  return `---
name: ${name}
description: ${JSON.stringify(description)}
tags: []
---

# ${name}

${description}

## Cuándo usarla

Describe aquí en qué situaciones el agente debería aplicar esta skill.

## Cómo

Los pasos concretos.
`;
}
