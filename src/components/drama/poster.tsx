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
}: {
  tone?: string;
  title?: string;
  chip?: string;
  duration?: string;
  progress?: number;
  src?: string | null;
  className?: string;
  ratio?: "23" | "916" | "34";
}) {
  return (
    <div className={cx("poster", tone, ratio === "916" && "ratio-916", ratio === "34" && "ratio-34", className)}>
      {src ? <img src={src} alt="" className="poster-photo" /> : null}
      {!src ? <span className="rim" /> : null}
      {!src ? <span className="head-s" /> : null}
      {!src ? <span className="body-s" /> : null}
      {chip ? <span className="pchip">{chip}</span> : null}
      {duration ? <span className="pdur">{duration}</span> : null}
      {title ? <span className="ptitle">{title}</span> : null}
      {progress != null ? (
        <span className="pbar">
          <i style={{ width: `${Math.max(progress, 2)}%` }} />
        </span>
      ) : null}
    </div>
  );
}
