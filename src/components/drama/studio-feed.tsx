import { memo, useEffect, useState, type ReactNode } from "react";
import type { ProductionAsset, ProductionCharacter, ProductionDetail } from "@/lib/api.ts";
import { sameAsset } from "@/lib/media.ts";

export const StudioFeed = memo(function StudioFeed({ run, ready = false }: { run: ProductionDetail; ready?: boolean }) {
  const characters = run.characters ?? [];
  const videos = (run.assets ?? []).filter((item) => item.mime.startsWith("video/") && item.url);
  const shoots = (run.shoots ?? []).filter((item) => item.status === "generating");
  const cover = run.cover_url
    ? { id: run.cover_url.split("?")[0] ?? "cover", kind: "series_cover", mime: "image/png", url: run.cover_url, label: "Series cover", created_at: run.updated_at }
    : null;

  return (
    <div className="rounded-xl border border-secondary bg-primary">
      <div className="border-b border-secondary px-6 py-4">
        <h3 className="text-lg font-semibold">{ready ? "Takes" : "Live feed"}</h3>
        <p className="mt-1 text-sm text-tertiary">
          {ready
            ? "Finished takes from this job."
            : shoots.length
              ? "Shots appear here as they finish. You can leave."
              : "Stills, voices, and takes land here as they finish."}
        </p>
      </div>
      <div className="flex max-h-[72vh] flex-col gap-4 overflow-y-auto p-5">
        {cover && !ready ? <CoverMessage key={cover.id} item={cover} /> : null}
        {ready ? null : characters.length === 0 ? (
          <FeedMessage title="Writing the cast">
            <Busy label="Creating the fictional characters from the story" />
          </FeedMessage>
        ) : (
          characters.map((character) => <CharacterMessage key={character.id} character={character} />)
        )}
        {shoots.map((item) => (
          <FeedMessage key={item.id} title={item.title ?? (item.episode_number && item.shot_position ? `Episode ${item.episode_number} · Shot ${item.shot_position}` : item.episode_number ? `Episode ${item.episode_number}` : "Shooting")}>
            <Busy label={item.label} />
          </FeedMessage>
        ))}
        {videos.map((item) => (
          <FeedMessage key={item.id} title={item.label || "Finished shot"}>
            <video className="aspect-[9/16] w-full max-w-[280px] rounded-lg bg-black" controls src={item.url} preload="metadata" />
          </FeedMessage>
        ))}
      </div>
    </div>
  );
});

function FeedMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="rounded-2xl border border-secondary bg-secondary_alt p-4">
      <div className="text-xs font-semibold tracking-wide text-tertiary uppercase">{title}</div>
      <div className="mt-3">{children}</div>
    </article>
  );
}

function CoverMessage({ item }: { item: ProductionAsset }) {
  const src = useStableUrl(item.url);
  return (
    <FeedMessage title="Series cover">
      {src ? (
        <img src={src} alt="" className="max-h-80 w-auto rounded-lg object-cover" />
      ) : (
        <Busy label="Creating the cover" />
      )}
    </FeedMessage>
  );
}

const CharacterMessage = memo(
  function CharacterMessage({ character }: { character: ProductionCharacter }) {
  const stillUrl = useStableUrl(character.still_url);
  const title = character.locked ? `${character.name} · locked` : character.name;

  return (
    <FeedMessage title={title}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="w-full max-w-[180px]">
          {stillUrl ? (
            <img src={stillUrl} alt="" className="aspect-[2/3] w-full rounded-lg object-cover" />
          ) : (
            <Busy label="Creating character" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{character.name}</div>
          {character.description ? <p className="mt-1 line-clamp-3 text-sm text-secondary">{character.description}</p> : null}
          <div className="mt-2 text-xs text-tertiary">
            {character.locked
              ? "Face and voice are locked for the rest of this series."
              : stillUrl
                ? character.voice_url
                  ? "Still is ready."
                  : "Still is ready. Voice is next."
                : "Still is being generated."}
          </div>
          <ReadyAudio src={character.voice_url} />
        </div>
      </div>
    </FeedMessage>
  );
},
  (prev, next) =>
    prev.character.id === next.character.id &&
    prev.character.locked === next.character.locked &&
    prev.character.name === next.character.name &&
    prev.character.description === next.character.description &&
    prev.character.still_asset_id === next.character.still_asset_id &&
    prev.character.voice_asset_id === next.character.voice_asset_id &&
    sameAsset(prev.character.still_url, next.character.still_url) &&
    sameAsset(prev.character.voice_url, next.character.voice_url) &&
    Boolean(prev.character.still_url) === Boolean(next.character.still_url) &&
    Boolean(prev.character.voice_url) === Boolean(next.character.voice_url),
);

function ReadyAudio({ src }: { src: string | null }) {
  const stable = useStableUrl(src);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!src || !stable) {
      setReady(false);
      return;
    }
    if (sameAsset(stable, src)) return;
    setReady(false);
  }, [src, stable]);
  if (!src || !stable) return null;
  return (
    <audio
      className={ready ? "mt-3 w-full" : "sr-only"}
      controls
      src={stable}
      preload="metadata"
      onLoadedMetadata={(event) => {
        setReady(event.currentTarget.duration > 0.5 && Number.isFinite(event.currentTarget.duration));
      }}
    />
  );
}

function useStableUrl(url: string | null | undefined) {
  const [current, setCurrent] = useState(url ?? null);
  useEffect(() => {
    if (!url) return;
    if (sameAsset(current, url)) return;
    setCurrent(url);
  }, [url, current]);
  return current;
}

function Busy({ label }: { label: string }) {
  return (
    <div className="flex aspect-[2/3] max-w-[180px] flex-col items-center justify-center gap-2 rounded-lg bg-primary" aria-busy="true">
      <span className="size-7 animate-spin rounded-full border-2 border-secondary border-t-brand-600" />
      <span className="px-3 text-center text-xs font-semibold text-tertiary">{label}</span>
    </div>
  );
}
