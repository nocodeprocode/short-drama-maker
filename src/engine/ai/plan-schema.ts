import type { EpisodePlan, ShotPlanScene, StoryBible } from "../domain.ts";
import type { EpisodeOutline } from "../../drama-engine/plans/long-form.ts";

/**
 * Structural validation for what the writer model returns. `JSON.parse as T`
 * trusted the shape and let a missing field surface later as an undefined
 * read deep inside repair or the planner. These checks fail at the boundary
 * with a path, so a bad completion is retried or reported as what it is.
 */
export class PlanShapeError extends Error {
  constructor(readonly path: string, readonly problem: string) {
    super(`Model output invalid at ${path}: ${problem}`);
    this.name = "PlanShapeError";
  }
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(obj: Obj, key: string, path: string, options: { optional?: boolean; nullable?: boolean } = {}): void {
  const value = obj[key];
  if (value === undefined) {
    if (options.optional) return;
    throw new PlanShapeError(`${path}.${key}`, "missing");
  }
  if (value === null) {
    if (options.nullable) return;
    throw new PlanShapeError(`${path}.${key}`, "null");
  }
  if (typeof value !== "string") throw new PlanShapeError(`${path}.${key}`, `expected string, got ${typeof value}`);
}

function num(obj: Obj, key: string, path: string, options: { optional?: boolean; min?: number; max?: number } = {}): void {
  const value = obj[key];
  if (value === undefined || value === null) {
    if (options.optional) return;
    throw new PlanShapeError(`${path}.${key}`, "missing");
  }
  if (typeof value !== "number" || !Number.isFinite(value)) throw new PlanShapeError(`${path}.${key}`, "expected a finite number");
  if (options.min != null && value < options.min) throw new PlanShapeError(`${path}.${key}`, `below ${options.min}`);
  if (options.max != null && value > options.max) throw new PlanShapeError(`${path}.${key}`, `above ${options.max}`);
}

function arr(obj: Obj, key: string, path: string, options: { min?: number; max?: number } = {}): unknown[] {
  const value = obj[key];
  if (!Array.isArray(value)) throw new PlanShapeError(`${path}.${key}`, "expected an array");
  if (options.min != null && value.length < options.min) throw new PlanShapeError(`${path}.${key}`, `needs at least ${options.min} items`);
  if (options.max != null && value.length > options.max) throw new PlanShapeError(`${path}.${key}`, `has more than ${options.max} items`);
  return value;
}

const SHOT_TYPES = new Set(["dialogue", "reaction", "establishing", "broll", "action", "insert"]);

export function validateShotShape(value: unknown, path: string): void {
  if (!isObj(value)) throw new PlanShapeError(path, "expected a shot object");
  str(value, "camera", path);
  if (typeof value.type !== "string") throw new PlanShapeError(`${path}.type`, "missing");
  if (!SHOT_TYPES.has(value.type)) {
    // Unknown types are tolerated but normalised later; a non-string is not.
  }
  if ("speaker" in value && value.speaker !== null && typeof value.speaker !== "string") {
    throw new PlanShapeError(`${path}.speaker`, "expected string or null");
  }
  if ("dialogue" in value && value.dialogue !== null && typeof value.dialogue !== "string") {
    throw new PlanShapeError(`${path}.dialogue`, "expected string or null");
  }
  if (value.dialogue && !value.speaker) throw new PlanShapeError(`${path}.speaker`, "dialogue without a speaker");
  num(value, "duration_hint_seconds", path, { optional: true, min: 0.2, max: 60 });
}

export function validateSceneShape(value: unknown, path: string): void {
  if (!isObj(value)) throw new PlanShapeError(path, "expected a scene object");
  str(value, "location", path);
  str(value, "time", path, { optional: true });
  const characters = arr(value, "characters", path);
  for (const [i, name] of characters.entries()) {
    if (typeof name !== "string") throw new PlanShapeError(`${path}.characters[${i}]`, "expected a name");
  }
  const shots = arr(value, "shots", path, { min: 1 });
  shots.forEach((shot, i) => validateShotShape(shot, `${path}.shots[${i}]`));
}

export function validatePlanShape(value: unknown): EpisodePlan {
  if (!isObj(value)) throw new PlanShapeError("plan", "expected an object");
  str(value, "title", "plan");
  const scenes = arr(value, "scenes", "plan", { min: 1, max: 60 });
  scenes.forEach((scene, i) => validateSceneShape(scene, `plan.scenes[${i}]`));
  return value as unknown as EpisodePlan;
}

export function validateBlockScenesShape(value: unknown): ShotPlanScene[] {
  if (!isObj(value)) throw new PlanShapeError("blocks", "expected an object with scenes");
  const scenes = arr(value, "scenes", "blocks", { min: 1, max: 30 });
  scenes.forEach((scene, i) => validateSceneShape(scene, `blocks.scenes[${i}]`));
  return value.scenes as ShotPlanScene[];
}

export function validateBibleShape(value: unknown): StoryBible {
  if (!isObj(value)) throw new PlanShapeError("bible", "expected an object");
  str(value, "title", "bible");
  str(value, "logline", "bible");
  const characters = arr(value, "characters", "bible", { min: 3, max: 8 });
  characters.forEach((character, i) => {
    const path = `bible.characters[${i}]`;
    if (!isObj(character)) throw new PlanShapeError(path, "expected a character object");
    str(character, "name", path);
    str(character, "description", path, { optional: true });
    str(character, "voice_design_prompt", path);
    if (!isObj(character.appearance)) throw new PlanShapeError(`${path}.appearance`, "missing");
    for (const key of ["age_look", "hair", "face", "body", "default_wardrobe"]) {
      str(character.appearance, key, `${path}.appearance`, { optional: true, nullable: true });
    }
  });
  if (value.locations !== undefined) {
    const locations = arr(value, "locations", "bible");
    locations.forEach((row, i) => {
      if (typeof row !== "string") throw new PlanShapeError(`bible.locations[${i}]`, "expected a string");
    });
  }
  return value as unknown as StoryBible;
}

export function validateOutlineShape(value: unknown): EpisodeOutline {
  if (!isObj(value)) throw new PlanShapeError("outline", "expected an object");
  const blocks = arr(value, "blocks", "outline", { min: 1, max: 40 });
  blocks.forEach((block, i) => {
    const path = `outline.blocks[${i}]`;
    if (!isObj(block)) throw new PlanShapeError(path, "expected a block object");
    num(block, "index", path, { optional: true, min: 0 });
    str(block, "title", path, { optional: true });
    str(block, "location", path, { optional: true });
  });
  return value as unknown as EpisodeOutline;
}
