import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isBlocked,
  liveDependencies,
  nextStatusFor,
  pendingDependencies,
  wouldCreateCycle,
  type DependencyState,
} from "./dependencies.js";

const done = (id: string): DependencyState => ({ id, status: "done" });
const open = (id: string, status = "todo"): DependencyState => ({ id, status });
const gone = (id: string): DependencyState => ({ id, status: null });

describe("pendingDependencies", () => {
  test("sin dependencias no hay nada pendiente", () => {
    assert.deepEqual(pendingDependencies([]), []);
    assert.equal(isBlocked([]), false);
  });

  test("solo 'done' cuenta como cumplida", () => {
    // En review el trabajo existe pero nadie lo ha revisado ni integrado.
    for (const status of ["todo", "in_progress", "review", "blocked"]) {
      assert.deepEqual(pendingDependencies([open("a", status)]), ["a"], status);
    }
    assert.deepEqual(pendingDependencies([done("a")]), []);
  });

  test("una dependencia borrada no bloquea", () => {
    // Si contara, la tarea quedaría bloqueada para siempre sin arreglo posible.
    assert.deepEqual(pendingDependencies([gone("a")]), []);
    assert.deepEqual(pendingDependencies([gone("a"), done("b")]), []);
    assert.deepEqual(pendingDependencies([gone("a"), open("b")]), ["b"]);
  });

  test("liveDependencies deja fuera las que ya no existen", () => {
    assert.deepEqual(liveDependencies([done("a"), gone("b"), open("c")]), ["a", "c"]);
  });
});

describe("nextStatusFor", () => {
  test("una tarea en todo con dependencias sin cumplir se bloquea", () => {
    const next = nextStatusFor("todo", [open("a")]);
    assert.equal(next?.status, "blocked");
  });

  test("una bloqueada se libera cuando todas están hechas", () => {
    const next = nextStatusFor("blocked", [done("a"), done("b")]);
    assert.equal(next?.status, "todo");
  });

  test("desbloquear la deja lista, no la lanza", () => {
    // El estado nunca salta a in_progress: gastar lo decide el usuario.
    const next = nextStatusFor("blocked", [done("a")]);
    assert.notEqual(next?.status, "in_progress");
  });

  test("no toca tareas que están corriendo, en revisión o cerradas", () => {
    for (const current of ["in_progress", "review", "done"]) {
      assert.equal(nextStatusFor(current, [open("a")]), null, current);
      assert.equal(nextStatusFor(current, [done("a")]), null, current);
    }
  });

  test("no repite el cambio si ya está en el estado correcto", () => {
    assert.equal(nextStatusFor("blocked", [open("a")]), null);
    assert.equal(nextStatusFor("todo", [done("a")]), null);
    assert.equal(nextStatusFor("todo", []), null);
  });
});

describe("wouldCreateCycle", () => {
  test("una tarea no puede depender de sí misma", () => {
    assert.equal(wouldCreateCycle("a", ["a"], new Map()), true);
  });

  test("detecta el ciclo directo", () => {
    // b ya depende de a; si a pasa a depender de b, ninguna arrancaría nunca.
    const graph = new Map([["b", ["a"]]]);
    assert.equal(wouldCreateCycle("a", ["b"], graph), true);
  });

  test("detecta el ciclo indirecto", () => {
    const graph = new Map([
      ["b", ["c"]],
      ["c", ["a"]],
    ]);
    assert.equal(wouldCreateCycle("a", ["b"], graph), true);
  });

  test("una cadena o un rombo no son ciclos", () => {
    const chain = new Map([["b", ["c"]]]);
    assert.equal(wouldCreateCycle("a", ["b"], chain), false);

    // a → b, a → c, y ambas → d: nadie vuelve sobre sus pasos.
    const diamond = new Map([
      ["b", ["d"]],
      ["c", ["d"]],
    ]);
    assert.equal(wouldCreateCycle("a", ["b", "c"], diamond), false);
  });

  test("un grafo con ciclo entre terceros no impide guardar lo tuyo", () => {
    const graph = new Map([
      ["x", ["y"]],
      ["y", ["x"]],
    ]);
    assert.equal(wouldCreateCycle("a", ["b"], graph), false);
  });
});
