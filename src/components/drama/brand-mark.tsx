import { IntersectThree } from "@phosphor-icons/react";
import { LEGAL_ENTITY } from "@/legal/entity.ts";
import { cx } from "@/utils/cx";

export function BrandMark({
  size = "md",
  wordmark = true,
  className,
}: {
  size?: "sm" | "md";
  wordmark?: boolean;
  className?: string;
}) {
  const tile = size === "sm" ? "size-8" : "size-10";
  const icon = size === "sm" ? 16 : 20;
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <span className={cx("grid place-items-center rounded-lg bg-brand-solid text-white shadow-xs", tile)}>
        <IntersectThree size={icon} weight="bold" />
      </span>
      {wordmark ? (
        <b className={cx("tracking-tight", size === "sm" ? "text-md" : "text-lg")}>{LEGAL_ENTITY.product_name}</b>
      ) : null}
    </span>
  );
}
