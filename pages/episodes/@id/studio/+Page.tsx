import { useMemo, useState } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { MediaPlayer, ShotThumb } from "@/components/drama/media-player.tsx";
import { Poster } from "@/components/drama/poster.tsx";
import { LoadError, StudioSkeleton } from "@/components/drama/skeleton.tsx";
import { CTA, statusLabel, studioPlayerMode } from "@/engine/present.ts";
import { studio, type EpisodeDetail } from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";

function shotLine(shot: EpisodeDetail["shots"][number]) {
  const dialogue = typeof shot.shot_data.dialogue === "string" ? shot.shot_data.dialogue.trim() : "";
  return dialogue;
}

function isSilent(shot: EpisodeDetail["shots"][number] | undefined) {
  return !shot || !shotLine(shot);
}

export default function Page() {
  const id = usePageContext().routeParams.id;
  const { data: episode, error, reload } = useStudio(`episode:${id}`, () => studio.episode(id), [id]);
  const [shotIndex, setShotIndex] = useState(0);

  const shots = useMemo(
    () => [...(episode?.shots ?? [])].sort((left, right) => (left.position ?? 0) - (right.position ?? 0)),
    [episode],
  );
  const shot = shots[shotIndex];
  const scene = episode?.scenes.find((item) => item.id === shot?.scene_id);
  const assembled = Boolean(episode?.final_url);
  const playerMode = studioPlayerMode({
    video_url: assembled ? episode?.final_url : shot?.video_url,
    status: shot?.status,
  });
  const shooting = playerMode === "shooting";
  const silent = isSilent(shot);
  const readyCount = shots.filter((item) => item.video_url || item.status === "complete").length;
  const complete = episode?.status === "complete";

  if (error && !episode) return <LoadError message={error} onRetry={() => void reload()} />;
  if (!episode) return <StudioSkeleton />;

  return (
    <div className="flex min-h-[calc(100dvh-56px)] flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-secondary bg-primary px-6 py-4">
        <div className="grow">
          <div className="text-sm font-semibold text-tertiary">
            {episode.series_title} · Episode {episode.episode_number}
          </div>
          <h1 className="text-xl font-semibold">
            {scene ? `Scene ${scene.position} · ${scene.location}` : "Timeline"}
          </h1>
          <p className="mt-1 text-sm text-secondary">
            {complete
              ? "This episode is ready. Watch the cut in order."
              : `Shooting for you · ${readyCount} of ${shots.length || 0} shots ready. You can close this page.`}
          </p>
        </div>
        <Button href={`/episodes/${id}`} color="secondary">
          Back to episode
        </Button>
        {episode.production_id ? (
          <Button href={`/productions/${episode.production_id}`} color="primary">
            {complete ? "Back to the show" : CTA.watchLive}
          </Button>
        ) : (
          <Button href="/series" color="primary">
            Back to shows
          </Button>
        )}
      </header>
      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[212px_1fr_348px]">
        <aside className="hidden overflow-auto border-r border-secondary bg-primary p-3 lg:block">
          <p className="px-2.5 pb-2 text-[11px] font-semibold tracking-wide text-tertiary uppercase">Scenes</p>
          {episode.scenes.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                const index = shots.findIndex((row) => row.scene_id === item.id);
                if (index >= 0) setShotIndex(index);
              }}
              className="flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm hover:bg-secondary_alt"
            >
              <span>
                {item.position} · {item.location}
              </span>
              <Badge type="pill-color" color={item.status === "complete" ? "success" : "gray"} size="sm">
                {statusLabel(item.status)}
              </Badge>
            </button>
          ))}
          <p className="mt-5 px-2.5 pb-2 text-[11px] font-semibold tracking-wide text-tertiary uppercase">Shots</p>
          <ol className="space-y-1.5">
            {shots.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setShotIndex(index)}
                  className={`w-full rounded-md px-2.5 py-2 text-left text-xs ${index === shotIndex ? "bg-secondary_alt" : ""}`}
                >
                  <span className="font-semibold text-tertiary">Shot {item.position}</span>
                  <div className="mt-0.5 line-clamp-2 text-secondary">
                    {shotLine(item) || "Silent beat"}
                    {typeof item.shot_data.speaker === "string" && item.shot_data.speaker
                      ? ` · ${item.shot_data.speaker}`
                      : ""}
                  </div>
                </button>
              </li>
            ))}
          </ol>
        </aside>
        <main className="flex flex-col items-center gap-4 overflow-auto bg-secondary_alt p-6">
          <div className="flex max-w-full gap-2.5 overflow-x-auto">
            {shots.map((item, index) => (
              <ShotThumb
                key={item.id}
                src={item.video_url}
                poster={item.still_url}
                tone="g1"
                label={`Shot ${item.position}`}
                selected={index === shotIndex}
                onClick={() => setShotIndex(index)}
              />
            ))}
          </div>
          {playerMode === "player" && (assembled ? episode.final_url : shot?.video_url) ? (
            <MediaPlayer
              src={(assembled ? episode.final_url : shot?.video_url) ?? ""}
              poster={shot?.still_url}
              autoPlay
              className="h-[min(52vh,440px)] aspect-[9/16] max-w-full"
              onEnded={() => {
                if (assembled) return;
                setShotIndex((index) => (index + 1 < shots.length ? index + 1 : index));
              }}
            />
          ) : shooting ? (
            <div className="grid h-[min(52vh,440px)] w-[min(52vh,248px)] place-items-center rounded-xl border border-secondary bg-primary">
              <div className="flex flex-col items-center gap-2 px-4 text-center">
                <span className="size-8 animate-spin rounded-full border-2 border-secondary border-t-brand-600" />
                <span className="text-sm font-semibold">Shooting this beat…</span>
              </div>
            </div>
          ) : (
            <Poster tone="g1" ratio="916" className="h-[min(52vh,440px)] w-auto" />
          )}
          <div className="text-xs text-tertiary">Shot {shot?.position ?? "—"}</div>
        </main>
        <aside className="overflow-auto bg-primary p-6">
          <div className="mb-4 flex items-center">
            <h3 className="text-lg font-semibold">
              Shot <span className="mono">{shot?.position ?? "—"}</span>
            </h3>
            <div className="grow" />
            <Badge type="pill-color" color={shot?.status === "complete" ? "success" : shooting ? "brand" : "gray"} size="sm">
              {shooting ? "Shooting" : silent ? "Silent beat" : statusLabel(shot?.status)}
            </Badge>
          </div>
          <label className="mb-1.5 block text-sm font-semibold">{silent ? "Beat" : "Dialogue"}</label>
          <textarea
            className="mb-4 min-h-20 w-full rounded-lg border border-primary p-3 text-sm"
            readOnly
            value={silent ? "Silent beat. No spoken line in this shot." : shotLine(shot!)}
          />
          <label className="mb-1.5 block text-sm font-semibold">Performance</label>
          <input
            className="mb-4 w-full rounded-lg border border-primary px-3 py-2.5 text-sm"
            readOnly
            value={String(shot?.shot_data.emotion ?? "")}
          />
          <label className="mb-1.5 block text-sm font-semibold">Action</label>
          <textarea
            className="mb-5 min-h-24 w-full rounded-lg border border-primary p-3 text-sm"
            readOnly
            value={String(shot?.shot_data.camera ?? "")}
          />
        </aside>
      </div>
    </div>
  );
}
