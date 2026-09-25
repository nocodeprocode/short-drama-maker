export const MODEST_DRESS_RULE =
  "Clothes stay on. Opaque contemporary short-drama wardrobe: a dress, a suit, a blouse, trousers. Stylish is fine. Do not take clothes off. No see-through cloth. " +
  // A jacket counts as dressed to an image model, and it answered with an open
  // blazer over a bare chest. Name the garment that has to be underneath.
  "A jacket or blazer is always worn over a buttoned shirt or a top: never over bare skin. Cloth covers the chest to the collarbone — no bare sternum, no plunging neckline, no cleavage. " +
  "Do not copy a public figure.";

export const MODEST_WARDROBE_EXAMPLES =
  "A fitted blouse or knit with trousers, a contemporary dress, a dark suit, a coat in the street. Clothes stay on. Opaque cloth.";

const MODEST_FAIL = /\b(sheer|see-?through|lingerie|brassiere|\bbra\b|bralette|underwear|undergarment|panties|boxers visible|nude mesh)\b/i;

/** Ingest hook: reject a take whose prompt or STT describes a modest-dress fail. */
export function modestDressFail(text?: string | null): boolean {
  return Boolean(text && MODEST_FAIL.test(text));
}
