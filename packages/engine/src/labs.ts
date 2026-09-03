/**
 * Built-in curriculum = two groups:
 *  - MODEL_LABS    (labs-models.ts)    reference topologies that pass Check as shipped;
 *  - EXERCISE_LABS (labs-exercises.ts) broken/incomplete labs with an official `solution` and hints.
 * `BUILTIN_LABS` is the flat list the API serves (models first, then exercises). Ids are stable: the UI stores
 * passed ids in localStorage and `modelId` links exercises to their model.
 */
import type { Engine } from './engine.ts';
import { EXERCISE_LABS } from './labs-exercises.ts';
import { MODEL_LABS } from './labs-models.ts';
import type { LabJson, LabKind, LabLevel } from './types.ts';

export { MODEL_LABS } from './labs-models.ts';
export { EXERCISE_LABS } from './labs-exercises.ts';

export const BUILTIN_LABS: LabJson[] = [...MODEL_LABS, ...EXERCISE_LABS];

export function labById(id: string): LabJson | undefined {
  return BUILTIN_LABS.find((l) => l.id === id);
}

/** What `GET /labs/builtin` serves: everything except the topology and the solution. */
export interface LabSummary {
  id: string;
  name: string;
  goal: string;
  description?: string;
  kind: LabKind;
  level?: LabLevel;
  topics: string[];
  /** Exercise → its model lab. */
  modelId?: string;
  /** Exercise with hints/solution the UI can reveal. */
  hasSolution: boolean;
  hintCount: number;
  checks: number;
  devices: number;
}

export function labSummary(l: LabJson): LabSummary {
  return {
    id: l.id,
    name: l.name,
    goal: l.goal ?? '',
    ...(l.description ? { description: l.description } : {}),
    kind: l.kind ?? 'model',
    ...(l.level ? { level: l.level } : {}),
    topics: l.topics ?? [],
    ...(l.modelId ? { modelId: l.modelId } : {}),
    hasSolution: !!l.solution,
    hintCount: l.solution?.hints.length ?? 0,
    checks: l.checks.length,
    devices: l.devices.length,
  };
}

/** Exercises built on a given model (for "try the exercise" links). */
export function exercisesForModel(modelId: string): LabJson[] {
  return EXERCISE_LABS.filter((l) => l.modelId === modelId);
}

/**
 * Applies an exercise's official solution to a running engine and re-runs Check.
 * Throws when the lab has no solution or the patch is rejected by a device CLI.
 */
export function applySolution(engine: Engine, lab: LabJson) {
  if (!lab.solution) throw new Error(`${lab.id} has no solution`);
  const r = engine.applyPatch(lab.solution.patch);
  if (!r.ok) throw new Error(`solution for ${lab.id} was rejected: ${r.error}`);
  return { applied: r.applied, check: engine.check() };
}
