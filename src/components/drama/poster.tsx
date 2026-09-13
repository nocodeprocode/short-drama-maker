import { cx } from "@/utils/cx";

export function Poster({
  tone = "g1",
  title,
  chip,
  duration,
  progress,
  src,
  className,
  ratio,
  working,
}: {
  tone?: string;
  title?: string;
  chip?: string;
  duration?: string;
  progress?: number;
  src?: string | null;
  className?: string;
  ratio?: "23" | "916" | "34";
  /**
   * Something is being generated for this poster right now. Adds a breathing
   * placeholder, a live dot on the chip, and a bar — a minutes-long generation
   * behind a still frame is indistinguishable from a broken screen.
   */
  working?: boolean;
}) {
  // A known total that is still on zero says less than a travelling bar does.
  const determinate = progress != null && progress > 0;
  return (
    <div
      className={cx(
        "poster",
        tone,
        ratio === "916" && "ratio-916",
        ratio === "34" && "ratio-34",
        working && "is-working",
        className,
      )}
    >
      {src ? <img src={src} alt="" className="poster-photo" /> : null}
      {!src ? <span className="rim" /> : null}
      {!src ? <span className="head-s" /> : null}
      {!src ? <span className="body-s" /> : null}
      {chip ? <span className={cx("pchip", working && "is-working")}>{chip}</span> : null}
      {duration ? <span className="pdur">{duration}</span> : null}
      {title ? <span className="ptitle">{title}</span> : null}
      {determinate ? (
        <span className={cx("pbar", working && "is-working")}>
          <i style={{ width: `${Math.max(progress, 2)}%` }} />
        </span>
      ) : working ? (
        <span className="pbar is-indeterminate">
          <i />
        </span>
      ) : progress != null ? (
        <span className="pbar">
          <i style={{ width: `${Math.max(progress, 2)}%` }} />
        </span>
      ) : null}
    </div>
  );
}
