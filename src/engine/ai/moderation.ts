import type { ModerationCheckpoint, ModerationVerdict } from "../domain.ts";
import type { ModerationEngine } from "./types.ts";

const REAL_PERSON =
  /\b(resembling|based on|real person|celebrity|actor|actress|influencer)\b/i;
const LOOKS_LIKE_PERSON =
  /\blooks? like\s+(?:a\s+)?(?:real person|celebrity|actor|actress|influencer|famous)\b/i;
const NAMED_LIKENESS =
  /\b(taylor swift|tom cruise|zendaya|beyonce|keanu|elon musk|mrbeast)\b/i;
const MINOR =
  /\b(child|children|kid|kids|toddler|infant|underage|minor|teen(?:ager)?|boy|girl)\b/i;
/** Always blocked, in any text: an explicit minor. */
const MINOR_EXPLICIT = /\b(underage|toddler|infant|teen(?:ager)?s?|schoolchild(?:ren)?|little (?:girl|boy))\b/i;
const AGE_UNDER_18 = /\b(?:1[0-7]|[1-9])\s*(?:year|yr)s?\s*old\b/i;
/**
 * Adult speech about the past or an endearment is not a depicted minor:
 * "went to school with a girl", "when I was a boy", "my girl", "the kids are
 * grown". Stripped before the word test on visual prompts; dialogue is only
 * held to the explicit rules above.
 */
const ADULT_REFERENCE =
  /\b(went to school with (?:a |the )?(?:girl|boy)|(?:when|since) (?:i|she|he|we|you) (?:was|were) (?:a |just a )?(?:girl|boy|kid|child)|as a (?:girl|boy|kid|child)|my (?:girl|boy)\b(?! ?friend)|(?:our|the|my|your|his|her) (?:kids|children) (?:are|were|have) (?:grown|adults|older)|(?:good|old|big|poor|clever|that) (?:girl|boy)\b)/gi;
const SEXUAL =
  /\b(nude|naked|nsfw|porn|sexual|sex scene|erotic|explicit|onlyfans|lingerie|bikini|crop top|midriff|sleep shirt|nightgown|undress|bedroom intimacy|on the bed together)\b/i;
const DRUGS =
  /\b(hashish|cannabis|cocaine|heroin|meth|snort(?:ing|s)?)\b/i;
const VIOLENCE =
  /\b(gun|pistol|rifle|shoot(?:s|ing|er)?|blood|stab|murder|kill(?:s|ing|ed)?|gore|fight club|punch(?:es|ing)? him|punch(?:es|ing)? her|strangl)\b/i;
const CRIME_ON_CAMERA =
  /\b(extort|break-?in|armed robbery|count the cash|launder|hitman|execute him|execute her)\b/i;

export class ContentBlockedError extends Error {
  constructor(readonly verdict: ModerationVerdict) {
    super(verdict.reason);
    this.name = "ContentBlockedError";
  }
}

export const moderation: ModerationEngine = {
  async check(content, checkpoint) {
    return moderateText(content, checkpoint);
  },
};

export function moderateText(
  content: string,
  checkpoint: ModerationCheckpoint,
): ModerationVerdict {
  if (SEXUAL.test(content)) {
    return {
      verdict: "block",
      category: "sexual",
      reason: "Sexual or intimate content is not allowed.",
    };
  }
  const pictured = checkpoint === "shot_submit" || checkpoint === "character_create";
  if (pictured && (DRUGS.test(content) || VIOLENCE.test(content) || CRIME_ON_CAMERA.test(content))) {
    return {
      verdict: "block",
      category: "uae_media",
      reason: "Drugs, weapons, or crime on camera are not allowed.",
    };
  }
  // A depicted minor is blocked wherever a person is pictured or cast; spoken
  // lines are adults talking, so only explicit minors and ages block there.
  const shownPerson = checkpoint !== "dialogue";
  const scrubbed = content.replace(ADULT_REFERENCE, " ");
  const minorHit = MINOR_EXPLICIT.test(content) || AGE_UNDER_18.test(content) || (shownPerson && MINOR.test(scrubbed));
  if (minorHit) {
    return {
      verdict: "block",
      category: "minor",
      reason: "Characters must be fictional adults. Minors are not allowed.",
    };
  }
  if (REAL_PERSON.test(content) || LOOKS_LIKE_PERSON.test(content) || NAMED_LIKENESS.test(content)) {
    return {
      verdict: "block",
      category: "real_person_likeness",
      reason: "Real-person names and likenesses are rejected. All characters must be fictional.",
    };
  }
  return { verdict: "allow", category: "ok", reason: "ok" };
}
