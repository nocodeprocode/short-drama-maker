export const MODEST_DRESS_RULE =
  "Every visible person is fully and modestly dressed for public viewing in the UAE: loose, non-form-fitting opaque clothes; long sleeves to the wrist; a closed high neckline with no chest opening or slit; loose trousers or a long skirt that cover the legs down to the shoe with no sheer panels and no cropped hems; closed indoor shoes. Face and hands only uncovered. No tight knits, no body-hugging silhouette, no sleepwear, no midriff, no low neckline, no sheer cloth, no shorts.";

export const MODEST_WARDROBE_EXAMPLES =
  "Loose long-sleeve tunic or blouse under a modest cardigan or blazer, wide-leg or straight full-length trousers, or a floor-length skirt. Neutral indoor colors. Loose enough that the body silhouette is not emphasized.";

const MODEST_FAIL = /\b(sheer|see-?through|lingerie|brassiere|\bbra\b|bralette|underwear|undergarment|panties|boxers visible|nude mesh)\b/i;

/** Ingest hook: reject a take whose prompt or STT describes a modest-dress fail. */
export function modestDressFail(text?: string | null): boolean {
  return Boolean(text && MODEST_FAIL.test(text));
}
