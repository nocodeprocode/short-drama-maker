import { isObjectInsert, type ShotFunction } from "../types/editorial.ts";

export type EditorialSceneKind = "recap" | "dialogue" | "evidence" | "button";

export type EditorialScene<T> = {
  index: number;
  kind: EditorialSceneKind;
  shots: T[];
};

type Classifiable = {
  function?: ShotFunction | null;
  type?: string | null;
  dialogue?: string | null;
  camera?: string | null;
  recap?: boolean;
  audio_role?: string | null;
  shot_data?: Classifiable;
};

function dataOf(shot: Classifiable): Classifiable {
  return shot.shot_data ?? shot;
}

export function classifyEditorialShot(shot: Classifiable): EditorialSceneKind {
  const data = dataOf(shot);
  if (data.recap) return "recap";
  if (data.function === "button_cu") return "button";
  if (isObjectInsert(data)) return "evidence";
  return "dialogue";
}

export function groupEditorialScenes<T extends Classifiable>(shots: T[]): EditorialScene<T>[] {
  const groups: EditorialScene<T>[] = [];
  for (const shot of shots) {
    const kind = classifyEditorialShot(shot);
    const prev = groups.at(-1);
    if (prev && prev.kind === kind) {
      prev.shots.push(shot);
      continue;
    }
    groups.push({ index: groups.length, kind, shots: [shot] });
  }
  return groups;
}
