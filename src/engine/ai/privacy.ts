import { STANDARD_PRIVACY, VIDEO_ROUTES } from "../config/models.ts";
import type { PrivacyProfile } from "../domain.ts";
import type { PrivacySettings } from "./types.ts";

export function privacySettings(_profile: PrivacyProfile): PrivacySettings {
  return {
    zdr: STANDARD_PRIVACY.zdr,
    data_collection: STANDARD_PRIVACY.data_collection,
    allow_fallbacks: false,
  };
}

export function assertStandardOnly(profile: string): asserts profile is PrivacyProfile {
  if (profile !== "standard") {
    throw new Error(
      "STRICT privacy is not shipped: no documented processing region for Seedance, and Veo cannot condition on our dialogue audio.",
    );
  }
}

export function isStrictEligible(model: string): boolean {
  return Object.values(VIDEO_ROUTES).some(
    (route) => route.model === model && route.strict_privacy_allowed,
  );
}
