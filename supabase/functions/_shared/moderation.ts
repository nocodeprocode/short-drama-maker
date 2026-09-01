export type ModerationVerdict = {
  verdict: "allow" | "block";
  category: string;
  reason: string;
};

const REAL_PERSON =
  /\b(looks? like|resembling|based on|real person|celebrity|actor|actress|influencer)\b/i;
const NAMED_LIKENESS =
  /\b(taylor swift|tom cruise|zendaya|beyonce|keanu|elon musk|mrbeast)\b/i;
const MINOR =
  /\b(child|children|kid|kids|toddler|infant|underage|minor|teen(?:ager)?|boy|girl)\b/i;
const AGE_UNDER_18 = /\b(?:1[0-7]|[1-9])\s*(?:year|yr)s?\s*old\b/i;
const SEXUAL =
  /\b(nude|naked|nsfw|porn|sexual|sex scene|erotic|explicit|onlyfans|lingerie|bikini|crop top|midriff|sleep shirt|nightgown)\b/i;

export function moderateText(content: string, _checkpoint: string): ModerationVerdict {
  if (SEXUAL.test(content)) {
    return { verdict: "block", category: "sexual", reason: "Sexual content is not allowed." };
  }
  if (MINOR.test(content) || AGE_UNDER_18.test(content)) {
    return {
      verdict: "block",
      category: "minor",
      reason: "Characters must be fictional adults. Minors are not allowed.",
    };
  }
  if (REAL_PERSON.test(content) || NAMED_LIKENESS.test(content)) {
    return {
      verdict: "block",
      category: "real_person_likeness",
      reason: "Real-person names and likenesses are rejected. All characters must be fictional.",
    };
  }
  return { verdict: "allow", category: "ok", reason: "ok" };
}
