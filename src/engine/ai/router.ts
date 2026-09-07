import { VIDEO_ROUTES } from "../config/models.ts";
import { isObjectInsert, isSceneTake } from "../../drama-engine/types/editorial.ts";
import type {
  PrivacyProfile,
  QualityProfile,
  RouteDecision,
  Shot,
  VideoRoute,
} from "../domain.ts";
import type { AIRouter } from "./types.ts";
import { assertStandardOnly } from "./privacy.ts";

function fitsDuration(route: VideoRoute, duration: number): boolean {
  return (
    duration + 1e-9 >= route.min_duration_seconds &&
    duration - 1e-9 <= route.max_duration_seconds
  );
}

function pick(
  role: VideoRoute["role"],
  duration: number,
  reason: string,
): RouteDecision {
  const route = VIDEO_ROUTES[role];
  if (!route.aspect_ratios.includes("9:16")) {
    throw new Error(`${route.model} does not support 9:16`);
  }
  if (!fitsDuration(route, duration)) {
    throw new Error(
      `${route.model} cannot hold ${duration}s (window ${route.min_duration_seconds}–${route.max_duration_seconds})`,
    );
  }
  return { route, reason };
}

function isOffscreen(shot: Shot): boolean {
  return shot.shot_data.audio_role === "offscreen" || shot.shot_data.function === "listener_hold";
}

function isAction(shot: Shot): boolean {
  return shot.shot_data.function === "slap_peak" || /\b(slap|punch|shove)\b/i.test(shot.shot_data.camera);
}

export function failoverRoute(_shot: Shot, current: VideoRoute): VideoRoute {
  if (current.model === "alibaba/wan-3.0") return VIDEO_ROUTES.economy_default;
  if (current.model === "bytedance/seedance-2.5") return VIDEO_ROUTES.economy_default;
  if (current.model === "bytedance/seedance-2.0-mini") return VIDEO_ROUTES.dialogue_default;
  if (current.model === VIDEO_ROUTES.action.model) return VIDEO_ROUTES.economy_default;
  return VIDEO_ROUTES.economy_default;
}

export function isIdentityCuShot(shot: Shot): boolean {
  if (isObjectInsert(shot.shot_data)) return false;
  if (shot.shot_data.audio_role === "silent" || shot.shot_data.audio_role === "offscreen") return false;
  if (shot.shot_data.function === "listener_hold" || shot.shot_data.type === "reaction") return false;
  const fn = shot.shot_data.function;
  return fn === "accusation_cu" || fn === "button_cu" || shot.shot_data.type === "dialogue";
}

function identityCuDecision(duration: number): RouteDecision | null {
  const model = process.env.DRAMA_CU_MODEL?.trim();
  if (!model) return null;
  const known = Object.values(VIDEO_ROUTES).find((row) => row.model === model);
  const route = known ?? { ...VIDEO_ROUTES.hero, model };
  const padded = Math.min(
    route.max_duration_seconds,
    Math.max(duration, route.min_duration_seconds),
  );
  if (!fitsDuration(route, padded) && known) {
    return pick(known.role, Math.max(duration, known.min_duration_seconds), `identity CU — ${model}`);
  }
  return { route: { ...route, model }, reason: `identity CU lock — ${model}` };
}

export const router: AIRouter = {
  selectVideoRoute(shot: Shot, privacy: PrivacyProfile, quality: QualityProfile) {
    assertStandardOnly(privacy);
    const raw = shot.shot_data.duration_seconds ?? shot.shot_data.duration_hint_seconds;
    const seedance = VIDEO_ROUTES.dialogue_default;
    const duration = Math.min(seedance.max_duration_seconds, Math.max(raw, seedance.min_duration_seconds));

    if (isSceneTake(shot.shot_data)) {
      return pick("hero", duration, "continuous scene take — Seedance 2.5");
    }

    if (isObjectInsert(shot.shot_data) && !shot.shot_data.dialogue) {
      return pick("economy_default", duration, "faceless object insert — economy fallback if the still plate cannot be cut");
    }

    const identity = isIdentityCuShot(shot) ? identityCuDecision(raw) : null;
    if (identity) return identity;

    const spokenOnCamera =
      Boolean(shot.shot_data.dialogue) && shot.shot_data.audio_role !== "offscreen" && shot.shot_data.audio_role !== "silent";
    if (spokenOnCamera) {
      return pick("dialogue_default", duration, "spoken on camera — Seedance 2.5 native audio");
    }

    if (shot.shot_data.function === "establishing" || shot.shot_data.type === "establishing") {
      return pick(
        "visual_default",
        Math.max(duration, VIDEO_ROUTES.visual_default.min_duration_seconds),
        "establishing / location beauty — Wan",
      );
    }
    if (shot.shot_data.function === "stacked_two") {
      return pick(
        "visual_default",
        Math.max(duration, VIDEO_ROUTES.visual_default.min_duration_seconds),
        "silent two-shot / group from locked still",
      );
    }

    // A listener or silent single still shows a locked face. The economy model
    // lost identity on every listener take in the live 15-minute run (the
    // bake-off said as much), so faces stay on the identity-holding route.
    if (isOffscreen(shot) || shot.shot_data.audio_role === "silent") {
      return pick("visual_default", Math.max(duration, VIDEO_ROUTES.visual_default.min_duration_seconds), "offscreen or silent single — identity route, no lipsync");
    }

    if (isAction(shot) && duration >= VIDEO_ROUTES.action.min_duration_seconds && duration <= VIDEO_ROUTES.action.max_duration_seconds) {
      return pick("action", duration, "action / slap — Kling multi_shots=false");
    }

    if (duration > VIDEO_ROUTES.economy_default.max_duration_seconds) {
      if (quality === "maximum" || shot.shot_data.hero || shot.shot_data.type === "hero") {
        return pick("hero", duration, "shot longer than 15s — Seedance 2.5 30s window");
      }
      if (shot.shot_data.type === "dialogue") {
        return pick("dialogue_default", duration, "dialogue on Wan 30s window");
      }
      return pick("visual_default", duration, "shot longer than 15s — Wan 30s window");
    }

    if (
      shot.shot_data.type === "dialogue" &&
      shot.shot_data.audio_role !== "offscreen" &&
      VIDEO_ROUTES.dialogue_default.audio_conditioning_verified
    ) {
      return pick("dialogue_default", duration, "verified audio-conditioned dialogue");
    }

    if (shot.shot_data.type === "reaction") {
      return pick("visual_default", Math.max(duration, VIDEO_ROUTES.visual_default.min_duration_seconds), "reaction single — identity route");
    }
    if (quality === "economy" || ["establishing", "broll"].includes(shot.shot_data.type)) {
      return pick("economy_default", duration, "silent or economy shot");
    }

    if (quality === "maximum" || shot.shot_data.hero || shot.shot_data.type === "hero") {
      return pick("hero", duration, "hero / maximum quality");
    }

    if (shot.shot_data.type === "dialogue") {
      return pick(
        "dialogue_default",
        duration,
        "dialogue default — audio preservation is VERIFY, not promised",
      );
    }

    return pick("visual_default", duration, "balanced visual default");
  },
};
