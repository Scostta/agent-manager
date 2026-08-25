import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { decideWorkspace, type WorkspaceFacts } from "./gc.js";

const OLDER_THAN = 7;

function facts(overrides: Partial<WorkspaceFacts> = {}): WorkspaceFacts {
  return {
    run: { status: "succeeded", strategy: "worktree", taskStatus: "review" },
    ageDays: 30,
    isGitWorktree: true,
    branchMerged: false,
    hasUncommitted: false,
    commits: 1,
    ...overrides,
  };
}

describe("decideWorkspace: reglas generales", () => {
  test("nunca toca una run en marcha, por vieja que parezca la carpeta", () => {
    for (const status of ["queued", "running"]) {
      const verdict = decideWorkspace(
        facts({ run: { status, strategy: "worktree", taskStatus: "in_progress" }, ageDays: 90 }),
        OLDER_THAN,
      );
      assert.equal(verdict.action, "keep", status);
    }
  });

  test("respeta la edad mínima", () => {
    assert.equal(decideWorkspace(facts({ ageDays: 6.9 }), OLDER_THAN).action, "keep");
    assert.notEqual(decideWorkspace(facts({ ageDays: 7.1 }), OLDER_THAN).action, "keep");
  });

  test("los cambios sin commitear mandan sobre todo lo demás", () => {
    // No están en ningún commit: esa carpeta es el único sitio donde existen.
    const combos: Partial<WorkspaceFacts>[] = [
      { hasUncommitted: true },
      { hasUncommitted: true, run: null },
      { hasUncommitted: true, branchMerged: true },
      { hasUncommitted: true, run: { status: "failed", strategy: "copy", taskStatus: "done" } },
    ];
    for (const overrides of combos) {
      assert.equal(decideWorkspace(facts(overrides), OLDER_THAN).action, "keep");
    }
  });
});

describe("decideWorkspace: carpetas sin registro", () => {
  // Si la BD se recrea o cambia WORKSPACES_ROOT, *todo* parece huérfano: no
  // puede ser una vía libre para borrar.
  test("un worktree limpio conserva su rama y solo pierde el directorio", () => {
    const verdict = decideWorkspace(
      facts({ run: null, isGitWorktree: true, hasUncommitted: false }),
      OLDER_THAN,
    );
    assert.equal(verdict.action, "dir");
  });

  test("una carpeta que no es un worktree se borra entera", () => {
    const verdict = decideWorkspace(
      facts({ run: null, isGitWorktree: false, hasUncommitted: false }),
      OLDER_THAN,
    );
    assert.equal(verdict.action, "all");
  });

  test("recién tocada no se toca aunque no tenga registro", () => {
    const verdict = decideWorkspace(
      facts({ run: null, isGitWorktree: false, ageDays: 1 }),
      OLDER_THAN,
    );
    assert.equal(verdict.action, "keep");
  });
});

describe("decideWorkspace: worktree", () => {
  test("una rama ya integrada se borra con rama y todo", () => {
    assert.equal(decideWorkspace(facts({ branchMerged: true }), OLDER_THAN).action, "all");
  });

  test("con commits sin integrar borra el directorio pero conserva la rama", () => {
    const verdict = decideWorkspace(facts({ commits: 3, branchMerged: false }), OLDER_THAN);
    assert.equal(verdict.action, "dir");
  });

  test("un worktree donde el agente no dejó nada se va entero", () => {
    const verdict = decideWorkspace(
      facts({ commits: 0, hasUncommitted: false, branchMerged: false }),
      OLDER_THAN,
    );
    assert.equal(verdict.action, "all");
  });
});

describe("decideWorkspace: copy", () => {
  const copy = (overrides: Partial<WorkspaceFacts["run"]> = {}, rest: Partial<WorkspaceFacts> = {}) =>
    facts({
      run: { status: "succeeded", strategy: "copy", taskStatus: "review", ...overrides },
      isGitWorktree: false,
      ...rest,
    });

  test("una run que salió bien y sigue abierta no se toca: no hay rama que la respalde", () => {
    assert.equal(decideWorkspace(copy(), OLDER_THAN).action, "keep");
  });

  test("si la tarea ya está cerrada, se limpia", () => {
    assert.equal(decideWorkspace(copy({ taskStatus: "done" }), OLDER_THAN).action, "all");
  });

  test("una run que no terminó bien se limpia", () => {
    for (const status of ["failed", "cancelled"]) {
      assert.equal(decideWorkspace(copy({ status }), OLDER_THAN).action, "all", status);
    }
  });

  // En copy no existe "conservar la rama": o está la carpeta o no hay nada.
  test("nunca devuelve el borrado parcial", () => {
    const combos = [
      { status: "succeeded", taskStatus: "review" },
      { status: "succeeded", taskStatus: "done" },
      { status: "failed", taskStatus: "todo" },
      { status: "cancelled", taskStatus: "blocked" },
    ];
    for (const overrides of combos) {
      assert.notEqual(decideWorkspace(copy(overrides), OLDER_THAN).action, "dir");
    }
  });
});
