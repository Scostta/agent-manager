import test, { describe } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import { ScaffoldError, normalizeRepoPath } from "./scaffold.js";

/**
 * Este guard existe porque el fallo es caro y silencioso: crear el proyecto en
 * la home dispara `git init` + `git add -A` sobre todo el perfil del usuario, y
 * después cada run copiaría lo mismo al workspace.
 */
describe("normalizeRepoPath", () => {
  test("acepta una carpeta normal y la resuelve", () => {
    const target = path.join(os.homedir(), "Proyectos", "algo");
    assert.equal(normalizeRepoPath(` ${target} `), path.resolve(target));
  });

  test("rechaza la carpeta personal", () => {
    assert.throws(() => normalizeRepoPath(os.homedir()), ScaffoldError);
    // Con separador final sigue siendo la home.
    assert.throws(() => normalizeRepoPath(os.homedir() + path.sep), ScaffoldError);
  });

  test("rechaza la raíz del disco", () => {
    assert.throws(() => normalizeRepoPath(path.parse(os.homedir()).root), ScaffoldError);
  });

  test("rechaza rutas relativas y vacías", () => {
    assert.throws(() => normalizeRepoPath("./relativo"), ScaffoldError);
    assert.throws(() => normalizeRepoPath("   "), ScaffoldError);
  });

  test("una subcarpeta de la home sí vale", () => {
    const sub = path.join(os.homedir(), "proyecto");
    assert.equal(normalizeRepoPath(sub), sub);
  });
});
