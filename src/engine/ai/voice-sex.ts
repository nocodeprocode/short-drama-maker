export type VoiceSex = "female" | "male" | "unknown";

export function inferVoiceSex(text: string): VoiceSex {
  const source = text.toLowerCase();
  const female = /\b(woman|female|girl|lady|wife|mother|sister|daughter|she|her)\b/.test(source);
  const male = /\b(man|male|boy|gentleman|husband|father|brother|son|he|him|his)\b/.test(source);
  if (female && !male) return "female";
  if (male && !female) return "male";
  if (/\b(woman|female|girl|lady|wife|mother)\b/.test(source)) return "female";
  if (/\b(man|male|boy|gentleman|husband|father)\b/.test(source)) return "male";
  return "unknown";
}

export function alignVoicePrompt(prompt: string, identityText: string): string {
  const sex = inferVoiceSex(`${identityText}\n${prompt}`);
  const trimmed = prompt.trim();
  if (sex === "female" && !/\b(female|woman|girl|lady)\b/i.test(trimmed)) {
    return `Adult woman. Female speaking voice. ${trimmed}`.trim();
  }
  if (sex === "male" && !/\b(male|man|boy|gentleman)\b/i.test(trimmed)) {
    return `Adult man. Male speaking voice. ${trimmed}`.trim();
  }
  return trimmed;
}

export type VoiceSexRepairAction = "none" | "align_prompt" | "unlock_wrong_sex";

export function voiceSexRepair(input: {
  locked: boolean;
  design_prompt: string;
  identityText: string;
}): { action: VoiceSexRepairAction; design_prompt: string } {
  const current = input.design_prompt.trim();
  const aligned = alignVoicePrompt(current, input.identityText);
  if (!aligned || aligned === current) {
    return { action: "none", design_prompt: current };
  }
  const currentSex = inferVoiceSex(current);
  const neededSex = inferVoiceSex(`${input.identityText}\n${aligned}`);
  if (input.locked && currentSex === neededSex && currentSex !== "unknown") {
    return { action: "none", design_prompt: current };
  }
  if (input.locked && neededSex !== "unknown" && currentSex !== neededSex) {
    return { action: "unlock_wrong_sex", design_prompt: aligned };
  }
  return { action: "align_prompt", design_prompt: aligned };
}
