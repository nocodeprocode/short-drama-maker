import type { ReactNode } from "react";
import { Poster } from "@/components/drama/poster.tsx";
import { cx } from "@/utils/cx";

/** Native list cell. Desktop pages keep the poster grid; mobile uses this row. */
export function MediaRow({
  href,
  tone,
  src,
  title,
  detail,
  trailing,
}: {
  href: string;
  tone?: string;
  src?: string | null;
  title: string;
  detail?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <a
      href={href}
      className={cx(
        "flex items-center gap-3 rounded-xl bg-primary px-3 py-2.5 ring-1 ring-secondary ring-inset",
        "active:bg-primary_hover",
      )}
    >
      <div className="w-12 shrink-0">
        <Poster tone={tone} src={src} />
      </div>
      <span className="min-w-0 grow">
        <span className="block truncate text-sm font-semibold text-primary">{title}</span>
        {detail ? <span className="mt-0.5 block truncate text-xs text-tertiary">{detail}</span> : null}
      </span>
      {trailing}
    </a>
  );
}
