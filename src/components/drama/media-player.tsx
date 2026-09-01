import { useEffect, useState } from "react";
import { Poster } from "@/components/drama/poster.tsx";
import { cx } from "@/utils/cx";

function Buffering({ poster }: { poster?: string | null }) {
  return (
    <div className="absolute inset-0 z-10 overflow-hidden">
      {poster ? <img src={poster} alt="" className="size-full object-cover opacity-40" /> : null}
      <div className="ds-skeleton absolute inset-0 opacity-80" />
      <div className="absolute inset-0 grid place-items-center">
        <span className="size-8 animate-spin rounded-full border-2 border-white/25 border-t-white" />
      </div>
    </div>
  );
}

export function MediaPlayer({
  src,
  poster,
  className,
  autoPlay,
  onEnded,
  onDuration,
}: {
  src: string;
  poster?: string | null;
  className?: string;
  autoPlay?: boolean;
  onEnded?: () => void;
  onDuration?: (seconds: number) => void;
}) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setReady(false);
    setFailed(false);
  }, [src]);

  return (
    <div className={cx("relative overflow-hidden rounded-xl bg-black", className)}>
      {!ready && !failed ? <Buffering poster={poster} /> : null}
      {failed ? (
        <div className="absolute inset-0 z-10 grid place-items-center px-4 text-center text-sm text-white">
          This take would not play. Try another shot.
        </div>
      ) : (
        <video
          key={src}
          className="size-full object-contain"
          controls
          autoPlay={autoPlay}
          playsInline
          preload="auto"
          poster={poster ?? undefined}
          src={src}
          onCanPlay={() => setReady(true)}
          onLoadedMetadata={(event) => {
            const duration = event.currentTarget.duration;
            if (Number.isFinite(duration) && duration > 0) onDuration?.(duration);
          }}
          onError={() => setFailed(true)}
          onEnded={onEnded}
        />
      )}
    </div>
  );
}

export function ShotThumb({
  src,
  poster,
  tone,
  label,
  selected,
  onClick,
}: {
  src?: string | null;
  poster?: string | null;
  tone?: string;
  label: string;
  selected?: boolean;
  onClick: () => void;
}) {
  const [ready, setReady] = useState(!src && !poster);

  useEffect(() => {
    setReady(!src && !poster);
  }, [src, poster]);

  return (
    <button
      type="button"
      aria-current={selected ? true : undefined}
      onClick={onClick}
      className={cx(
        "w-[74px] shrink-0 rounded-xl border bg-primary p-1",
        selected ? "border-brand-600 ring-4 ring-brand-100" : "border-secondary",
      )}
    >
      <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-black">
        {!ready ? <div className="ds-skeleton absolute inset-0" /> : null}
        {src ? (
          <video
            className="size-full object-cover"
            src={src}
            poster={poster ?? undefined}
            muted
            playsInline
            preload="metadata"
            onLoadedData={() => setReady(true)}
          />
        ) : poster ? (
          <img src={poster} alt="" className="size-full object-cover" onLoad={() => setReady(true)} />
        ) : (
          <Poster tone={tone} ratio="916" />
        )}
      </div>
      <div className="mt-1 text-center text-[11px] text-tertiary">{label}</div>
    </button>
  );
}
