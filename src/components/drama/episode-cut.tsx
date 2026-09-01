import { useEffect, useMemo, useState } from "react";
import { MediaPlayer, ShotThumb } from "@/components/drama/media-player.tsx";
import { Poster } from "@/components/drama/poster.tsx";
import { formatClock, nextCutIndex, playableShots } from "@/engine/present.ts";

type Shot = {
  id: string;
  position: number;
  video_url?: string | null;
  still_url?: string | null;
};

export function EpisodeCut({
  shots,
  tone,
  finalUrl,
}: {
  shots: Shot[];
  tone?: string;
  finalUrl?: string | null;
}) {
  const files = useMemo(() => playableShots(shots), [shots]);
  const [index, setIndex] = useState(0);
  const [lengths, setLengths] = useState<Record<string, number>>({});
  const current = files[index];
  const assembled = Boolean(finalUrl);

  useEffect(() => {
    if (index >= files.length && files.length) setIndex(0);
  }, [files.length, index]);

  const total = files.reduce((sum, shot) => sum + (lengths[shot.id] ?? 0), 0);
  const known = files.filter((shot) => lengths[shot.id] != null).length;

  if (!current?.video_url) {
    return <Poster tone={tone} ratio="916" />;
  }

  return (
    <div>
      {files[index + 1]?.video_url ? (
        <video className="hidden" src={files[index + 1].video_url ?? undefined} preload="auto" muted playsInline />
      ) : null}
      <MediaPlayer
        src={assembled ? finalUrl! : current.video_url}
        poster={current.still_url}
        autoPlay
        className="aspect-[9/16] w-full"
        onDuration={(duration) => {
          if (assembled) return;
          setLengths((prev) => (prev[current.id] === duration ? prev : { ...prev, [current.id]: duration }));
        }}
        onEnded={() => {
          if (assembled) return;
          setIndex((value) => nextCutIndex(value, files.length));
        }}
      />
      <p className="mt-2 text-sm text-secondary">
        {assembled
          ? "Assembled episode"
          : `Shot ${index + 1} of ${files.length}`}
        {!assembled && known === files.length && total > 0 ? ` · ${formatClock(total)} cut` : ""}
        {!assembled && index + 1 < files.length ? " · plays through" : ""}
      </p>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {files.map((shot, shotIndex) => (
          <ShotThumb
            key={shot.id}
            src={shot.video_url}
            poster={shot.still_url}
            tone={tone}
            label={String(shotIndex + 1)}
            selected={shotIndex === index}
            onClick={() => setIndex(shotIndex)}
          />
        ))}
      </div>
    </div>
  );
}
