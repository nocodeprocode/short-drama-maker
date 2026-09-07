import type { ShotFunction } from "../domain.ts";
import { firstFrameKind } from "../media/face-crop.ts";
import { isObjectInsert } from "../../drama-engine/types/editorial.ts";

export const BLOCKING_STILL_KIND = "blocking_still";
export const BLOCKING_STILL_IDENTITY_MIN = 0.7;

/** Locked after the live probe. two_ref composites face+plate; plate_seed is the fallback. */
export type BlockingStillMode = "two_ref" | "plate_seed";
export const BLOCKING_STILL_MODE: BlockingStillMode = "plate_seed";

export type BlockingFraming = "cu" | "mcu" | "reaction";

const BLOCKING_FUNCTIONS = new Set<string>([
  "hook_cu",
  "accusation_cu",
  "listener_hold",
  "reaction",
  "button_cu",
  "block_button",
  "slap_peak",
  "doorway_reveal",
  "scene_take",
]);

export function blockingFramingFor(fn?: ShotFunction | string | null): BlockingFraming {
  if (fn === "reaction" || fn === "listener_hold") return "reaction";
  return "mcu";
}

export function blockingStillKey(characterId: string, location: string, framing: BlockingFraming): string {
  return `${characterId}::${location.trim().toLowerCase()}::${framing}`;
}

export function shouldUseBlockingStill(shot: {
  function?: ShotFunction | string | null;
  type?: string | null;
  dialogue?: string | null;
  audio_role?: string | null;
  camera?: string | null;
}): boolean {
  if (isObjectInsert(shot)) return false;
  if (shot.function && BLOCKING_FUNCTIONS.has(shot.function)) return true;
  if (shot.type === "dialogue" || shot.type === "reaction" || shot.type === "hero") return true;
  return false;
}

export function selectShotRefs(input: {
  lastFrameUrl?: string | null;
  lastFrameId?: string | null;
  blockingUrl?: string | null;
  blockingId?: string | null;
  faceUrl?: string | null;
  faceUrls?: Array<string | null | undefined>;
  faceId?: string | null;
  faceKind?: string | null;
  /** Seedance reference-to-video: faces first so @Image1 is the locked identity. */
  identityFirst?: boolean;
}): {
  urls: string[];
  first_frame_kind: ReturnType<typeof firstFrameKind>;
  first_frame_asset_id: string | null;
} {
  const faces = [...(input.faceUrls ?? []), input.faceUrl].filter((url): url is string => Boolean(url));
  const room = input.lastFrameUrl
    ? { url: input.lastFrameUrl, id: input.lastFrameId ?? null, kind: "blocking_still" }
    : input.blockingUrl
      ? { url: input.blockingUrl, id: input.blockingId ?? null, kind: "blocking_still" }
      : null;
  const first = input.identityFirst
    ? faces[0]
      ? { url: faces[0], id: input.faceId ?? null, kind: input.faceKind ?? "front" }
      : room
    : room ?? (faces[0] ? { url: faces[0], id: input.faceId ?? null, kind: input.faceKind ?? "cu" } : null);
  if (!first) return { urls: [], first_frame_kind: "face", first_frame_asset_id: null };
  const urls: string[] = [];
  const push = (url?: string | null) => {
    if (url && !urls.includes(url)) urls.push(url);
  };
  if (input.identityFirst) {
    for (const face of faces) push(face);
    push(room?.url ?? null);
  } else {
    push(first.url);
    for (const face of faces) push(face);
  }
  return {
    urls: urls.slice(0, 4),
    first_frame_kind: firstFrameKind(first.kind),
    first_frame_asset_id: first.id,
  };
}
