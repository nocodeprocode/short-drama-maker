import { cx } from "@/utils/cx";

export function EpisodeStrip({
  start,
  end,
  states,
  hrefs,
  numbered = true,
}: {
  start: number;
  end: number;
  states?: Record<number, string>;
  hrefs?: Record<number, string>;
  numbered?: boolean;
}) {
  const count = Math.max(0, end - start + 1);
  const dropLabels = count > 24;
  return (
    <div className={cx("epstrip", numbered && !dropLabels && "numbered")} aria-label={`Episodes ${start} to ${end}`}>
      {Array.from({ length: count }, (_, index) => {
        const n = start + index;
        const state = states?.[n] ?? "";
        const href = hrefs?.[n];
        const label = dropLabels ? "" : n;
        if (href) {
          return (
            <a key={n} href={href} className={state} title={`Watch episode ${n}`}>
              {label}
            </a>
          );
        }
        return (
          <span key={n} className={state} title={`Episode ${n}`}>
            {label}
          </span>
        );
      })}
    </div>
  );
}
