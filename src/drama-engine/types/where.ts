/**
 * Genre-agnostic law: a werewolf / vampire / magic show is mostly a real room.
 * The power is WHERE it happens — one licensed beat — not a costume the camera
 * wears on every cut. Writer, polish, prompt, and lint share this clause.
 */

/**
 * Banning "flash gold" is not enough. A striking iris colour rendered in a dark
 * room comes back emissive — vivid, self-lit, contact-lens green — which reads
 * as a power even though no power was written. The iris is a surface that
 * reflects light, never a source of it.
 */
export const HUMAN_EYE_CLAUSE =
  "HUMAN EYES. Irises are matte and natural, the same everyday colour a person has in a dim room. " +
  "The iris REFLECTS the lamp; it never emits light. FORBIDDEN: a self-lit or glowing iris, a saturated " +
  "neon or contact-lens colour, an iris brighter than the skin, an iris that stays bright when the face " +
  "is in shadow, bloom or halo around the eye, a ring light in the pupil. In a dark room the eyes go " +
  "darker with the face — they do not stay lit.";

export const WHERE_RULES =
  "WHERE. This is a real scene in a real room. Human faces. Human eyes. " +
  "A werewolf, a vampire, or a power is one beat, under a second, only if a parenthetical licenses it. " +
  "Then human eyes again. FORBIDDEN as a look: flashing eyes, gold-eye ECU, glowing irises, fangs, fur, snout, claws, " +
  "a body changing, magic particles, an aura, a scent-reaction face on every cut. " +
  `Do not highlight the feature. The rest of the take is two people talking. ${HUMAN_EYE_CLAUSE}`;

/** Creature / transform — never legal on camera. */
export const POWER_CREATURE =
  /\b(snout|muzzle|wolf form|werewolf form|body chang|transform(?:ing|ation)?|grows fur|sprouts? (?:fur|claws)|fangs?(?: out)?|vampire teeth|claws out|magic particles?|aura glow|floating spark)\b/i;

/** Highlighted power look — legal once per episode as a parenthetical, never as the default face. */
export const POWER_TELL =
  /\b(gold[- ]eyes?(?:\s+ecu)?|eyes? (?:that )?(?:can )?(?:flash|glow|burn|flare)(?: gold)?|flash(?:ing)? gold|glowing (?:eyes?|iris)|irises? (?:flash|glow)|(?:luminous|glowing) (?:\w+ ){0,2}(?:eyes?|iris(?:es)?)|(?:eyes?|iris(?:es)?) (?:that )?(?:seem to )?(?:glow|shine|burn)|scent(?:-| )(?:hit|reaction)|low growl|eyes? flash)\b/i;

/**
 * A jewel iris is a power tell nobody wrote. Image and video models render a
 * saturated eye colour as self-lit in a dim room, so "pale green eyes" comes
 * back neon — and the face still is the only legal face, so it never washes out.
 */
export const NEON_IRIS =
  /\b(?:bright|vivid|pale|piercing|electric|neon|jewel|luminous|striking|brilliant|emerald|amber|violet|ice[- ]?blue|gold(?:en)?)\s+(?:\w+\s+){0,1}(?:eyes?|iris(?:es)?)\b|\b(?:eyes?|iris(?:es)?)\s+(?:of\s+)?(?:emerald|amber|violet|neon)\b/i;

export function hasNeonIris(text?: string | null): boolean {
  return NEON_IRIS.test(text ?? "");
}

/**
 * Drop eye colour from anything handed to a video model.
 *
 * The locked still already carries the eyes — that is what the identity lock is
 * for. Naming a colour on top of it is redundant, and the model treats it as
 * something to render: state "green eyes" over a dark room and it paints two
 * lit points. Bone, mouth, hair and skin still describe the face.
 */
export function stripIrisPhrases(text: string | null | undefined): string {
  const raw = (text ?? "").trim();
  if (!raw) return "";
  return raw
    .split(/\s*,\s*/)
    .filter((part) => !/\b(eyes?|iris(?:es)?|pupils?)\b/i.test(part))
    .join(", ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,;\s]+|[,;\s]+$/g, "")
    .trim();
}

export type WhereTake = {
  script?: string | null;
  camera?: string | null;
  emotion?: string | null;
  staging?: string | null;
};

export type WhereHit = {
  kind: "creature" | "tell_spam" | "unlicensed_look";
  detail: string;
};

function blob(take: WhereTake): string {
  return [take.script, take.camera, take.emotion, take.staging].filter(Boolean).join("\n");
}

export function hasPowerCreature(text?: string | null): boolean {
  return POWER_CREATURE.test(text ?? "");
}

export function hasPowerTell(text?: string | null): boolean {
  return POWER_TELL.test(text ?? "");
}

export function licensedTell(script?: string | null): boolean {
  return /\([^)]{0,80}\b(gold[- ]eyes?|eyes? (?:flash|glow)|flash gold|scent|growl)\b[^)]{0,40}\)/i.test(script ?? "");
}

/** Motifs that belong on a still plate, not as a glowing face every take. */
export function humanMotifs(motifs: readonly string[] | null | undefined): string[] {
  return (motifs ?? []).filter((row) => !POWER_TELL.test(row) && !POWER_CREATURE.test(row));
}

export function stripPowerLanguage(text: string | null | undefined): string {
  return (text ?? "")
    .replace(
      /\([^)]{0,80}\b(gold[- ]eyes?|eyes? (?:flash|glow|burn|flare)|flash gold|glowing eyes|scent(?:-| )(?:hit|reaction)|low growl|fangs?|snout|fur|claws|transform)[^)]{0,40}\)/gi,
      "",
    )
    .replace(POWER_CREATURE, "")
    .replace(/\b(?:that )?(?:can )?(?:flash|glow|burn|flare)(?: gold)?(?: for one beat)?\b/gi, "")
    .replace(/\bgold[- ]eyes?(?:\s+ecu)?\b/gi, "eyes")
    .replace(/\bglowing (?:eyes?|iris(?:es)?)\b/gi, "eyes")
    .replace(/\b(?:scent(?:-| )(?:hit|reaction)|low growl)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/\(\s*\)/g, "")
    .trim();
}

export function whereProblems(takes: readonly WhereTake[]): WhereHit[] {
  const hits: WhereHit[] = [];
  const tellTakes: number[] = [];
  for (const [index, take] of takes.entries()) {
    const text = blob(take);
    if (hasPowerCreature(text)) {
      hits.push({ kind: "creature", detail: `take ${index + 1} shows a creature or transform` });
    }
    if (hasPowerTell(text)) tellTakes.push(index);
    const look = `${take.camera ?? ""} ${take.emotion ?? ""} ${take.staging ?? ""}`;
    if (hasPowerTell(look) && !licensedTell(take.script)) {
      hits.push({
        kind: "unlicensed_look",
        detail: `take ${index + 1} paints a power look without a licensed parenthetical`,
      });
    }
  }
  if (tellTakes.length > 1) {
    hits.push({
      kind: "tell_spam",
      detail: `power tell on ${tellTakes.length} takes — one beat per episode, then a real room`,
    });
  }
  return hits;
}

/** Keep the first licensed parenthetical; strip every other power look. */
export function stripWhereTakes<T extends WhereTake>(takes: T[]): T[] {
  let kept = false;
  return takes.map((take) => {
    const license = licensedTell(take.script);
    if (license && !kept) {
      kept = true;
      return {
        ...take,
        camera: take.camera ? stripPowerLanguage(take.camera) : take.camera,
        emotion: take.emotion ? stripPowerLanguage(take.emotion) : take.emotion,
        staging: take.staging ? stripPowerLanguage(take.staging) : take.staging,
      };
    }
    return {
      ...take,
      script: take.script ? stripPowerLanguage(take.script) : take.script,
      camera: take.camera ? stripPowerLanguage(take.camera) : take.camera,
      emotion: take.emotion ? stripPowerLanguage(take.emotion) : take.emotion,
      staging: take.staging ? stripPowerLanguage(take.staging) : take.staging,
    };
  });
}

export function wherePromptClause(script?: string | null): string {
  if (licensedTell(script)) {
    return `${WHERE_RULES} This take has one licensed power beat in a parenthetical. Under one second. Then human eyes. Do not repeat. Do not glow the rest of the take.`;
  }
  return `${WHERE_RULES} This take has no licensed power beat. Human eyes. Human faces. A real room.`;
}
