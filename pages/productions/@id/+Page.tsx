import { useEffect, useMemo, useRef, useState } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { Pause, Play } from "@phosphor-icons/react";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { EpisodeStrip } from "@/components/drama/episode-strip.tsx";
import { ShotGrid } from "@/components/drama/shot-grid.tsx";
import { StudioFeed } from "@/components/drama/studio-feed.tsx";
import {
  CTA,
  compactProductionLog,
  currentTaskFailure,
  episodeStripStates,
  progressForPhase,
  shotGridCounts,
  statusBadgeColor,
  statusLabel,
  watchLinksForEpisodes,
} from "@/engine/present.ts";
import { LiveShowSkeleton, LoadError } from "@/components/drama/skeleton.tsx";
import { studio, type ProductionDetail } from "@/lib/api.ts";
import { readCache, writeCache } from "@/lib/cache.ts";
import { useLiveReload, useSessionReady } from "@/lib/use-studio.ts";

function taskColor(status: string) {
  if (status === "done" || status === "completed") return "success" as const;
  if (status === "failed") return "error" as const;
  if (status === "running") return "brand" as const;
  return "gray" as const;
}

export default function Page() {
  const page = usePageContext();
  const id = page.routeParams.id;
  const paid = String(page.urlParsed.search.checkout ?? "") === "success";
  const sessionReady = useSessionReady();
  const cacheKey = `production:${id}`;
  const [run, setRun] = useState<ProductionDetail | null>(() => readCache<ProductionDetail>(cacheKey));
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const hasRun = useRef(Boolean(run));

  const reload = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    studio
      .production(id)
      .then((data) => {
        hasRun.current = true;
        setRun((previous) => {
          const next = mergeProduction(previous, data);
          writeCache(cacheKey, next);
          return next;
        });
        setError(null);
      })
      .catch((caught) => {
        if (!hasRun.current) setError(caught instanceof Error ? caught.message : "Could not open this show");
      })
      .finally(() => {
        inFlight.current = false;
      });
  };

  useEffect(() => {
    if (!sessionReady) return;
    reload();
  }, [id, sessionReady]);

  useLiveReload(reload, [id], sessionReady);

  const working = useMemo(() => run?.tasks.find((task) => task.status === "running") ?? run?.current_step ?? null, [run]);
  const latestFailure = useMemo(
    () => (run ? currentTaskFailure(run.tasks ?? [], run.status) : null),
    [run],
  );
  const log = useMemo(
    () =>
      compactProductionLog(run?.tasks ?? [], run?.characters ?? [], {
        hasFinishedShot: Boolean(
          (run?.assets ?? []).some((item) => item.kind === "shot_video" || item.mime.startsWith("video/")) ||
            (run?.shoots ?? []).some((item) => item.status === "complete"),
        ),
      }),
    [run],
  );

  if (error && !run) return <LoadError message={error} onRetry={reload} />;
  if (!run) return <LiveShowSkeleton />;

  const ready = run.status === "ready";
  const shooting = run.status === "running" || run.status === "queued";
  const statusText = statusLabel(run.status, run.paused);
  const canPause = !run.paused && shooting;
  const canResume = run.paused && run.status !== "awaiting_payment";
  const watch = watchLinksForEpisodes(run.episodes);
  const shots = run.shoots ?? [];
  const grid = shotGridCounts(shots);
  const progress = run.progress ?? progressForPhase(run.ui_phase, run.status);
  const totalEpisodes = run.episode_end - run.episode_start + 1;
  const doneEpisodes = run.episodes.filter((episode) => episode.status === "complete").length;
  const leaveCopy = ready
    ? "Ready to watch."
    : working?.title
      ? `${working.title}. You can leave.`
      : "The studio is working. You can leave.";

  return (
    <>
      <PageHeader
        eyebrow={run.sku === "2" ? `Pilot ${Math.max(doneEpisodes, 1)} of ${totalEpisodes}` : `Episodes ${run.episode_start}–${run.episode_end}`}
        title={run.series_title ?? "Show"}
        subtitle={leaveCopy}
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge type="pill-color" color={statusBadgeColor(run.status, run.paused)} size="sm">
              {statusText}
            </Badge>
            {canResume ? (
              <Button color="primary" iconLeading={Play} onClick={() => studio.resume(run.id).then(reload)}>
                Resume
              </Button>
            ) : null}
            {canPause ? (
              <Button color="secondary" iconLeading={Pause} onClick={() => studio.pause(run.id).then(reload)}>
                Pause
              </Button>
            ) : null}
            {watch.map((link) => (
              <Button key={link.href} href={link.href} color={ready ? "primary" : "secondary"}>
                {link.label}
              </Button>
            ))}
            {run.status === "awaiting_payment" ? (
              <Button
                color="primary"
                onClick={() =>
                  studio
                    .confirmTest(run.id)
                    .then(reload)
                    .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not confirm"))
                }
              >
                {CTA.payAndStart}
              </Button>
            ) : null}
            {run.series_id ? (
              <Button href={`/series/${run.series_id}`} color="tertiary">
                Open show
              </Button>
            ) : null}
          </div>
        }
      />
      {run.status === "needs_user" ? (
        <div className="border-b border-warning-200 bg-warning-50 px-4 py-4 sm:px-8">
          <div className="mx-auto flex max-w-[1320px] flex-wrap items-start gap-3">
            <div className="min-w-0 grow">
              <div className="text-xs font-semibold tracking-wide text-warning-700 uppercase">Needs you</div>
              <p className="mt-1 text-sm font-semibold text-primary">{run.headline ?? run.agent_decision ?? "This show is waiting for you."}</p>
              {latestFailure?.error_code || latestFailure?.detail ? (
                <p className="mt-1 text-sm text-secondary">{latestFailure.error_code ?? latestFailure.detail}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {run.intervention_type === "quality_budget" ? (
                <Button color="primary" onClick={() => studio.useBest(run.id).then(reload)}>
                  {CTA.useBest}
                </Button>
              ) : null}
              {run.intervention_type === "technical" || !run.intervention_type ? (
                <Button color="primary" onClick={() => studio.resume(run.id).then(reload)}>
                  {CTA.retry}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : latestFailure?.error_code ? (
        <div className="border-b border-secondary bg-primary px-4 py-3 sm:px-8">
          <p className="mx-auto max-w-[1320px] text-sm text-secondary">Retrying automatically.</p>
        </div>
      ) : null}
      <PageBody>
        {paid ? (
          <div className="mb-5 rounded-xl border border-brand-200 bg-brand-25 px-4 py-3 text-sm">
            Payment received. The studio started. You can leave this page.
          </div>
        ) : null}

        {ready ? null : (
          <div className="mb-5 rounded-xl border border-secondary bg-primary p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold tracking-wide text-tertiary uppercase">Now</div>
                <h2 className="mt-1 text-lg font-semibold">{working?.title ?? run.headline ?? "Preparing this show"}</h2>
                <p className="mt-1 text-sm text-secondary">{working?.detail ?? "You can close this page."}</p>
              </div>
              <span className="text-sm text-tertiary">
                Episode {Math.min(doneEpisodes + 1, totalEpisodes)} of {totalEpisodes}
              </span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, progress)}%` }} />
            </div>
            <div className="mt-4">
              <EpisodeStrip
                start={run.episode_start}
                end={run.episode_end}
                states={episodeStripStates(run.episodes)}
                hrefs={Object.fromEntries(watch.map((link) => [link.episode_number, link.href]))}
              />
            </div>
            {shots.length ? (
              <div className="mt-4">
                <ShotGrid {...grid} />
              </div>
            ) : null}
          </div>
        )}

        {ready ? (
          <div className="mb-5 rounded-xl border border-success-200 bg-success-50 p-5">
            <h2 className="text-lg font-semibold">Ready to watch</h2>
            <p className="mt-1 text-sm text-secondary">The pilot is cut. Watch it, then approve the cast if it feels right.</p>
            <div className="mt-4">
              <EpisodeStrip
                start={run.episode_start}
                end={run.episode_end}
                states={episodeStripStates(run.episodes)}
                hrefs={Object.fromEntries(
                  run.episodes
                    .filter((episode) => episode.status === "complete")
                    .map((episode) => [episode.episode_number, `/episodes/${episode.id}`]),
                )}
              />
            </div>
          </div>
        ) : null}

        <StudioFeed run={run} ready={ready} />

        {ready ? null : (
          <div className="mt-5 rounded-xl border border-secondary bg-primary">
            <div className="border-b border-secondary px-6 py-4">
              <h3 className="text-lg font-semibold">What just happened</h3>
            </div>
            <div className="p-6">
              {(log.length ? log : [{ id: "idle", action: "waiting", status: run.status, error_code: null, title: "Waiting to start", detail: run.headline ?? "", status_label: statusText }]).map((task, index) => (
                <div key={task.id} className="grid grid-cols-[32px_1fr_auto] gap-3.5 border-b border-secondary py-3.5 last:border-0">
                  <div className="grid size-7 place-items-center rounded-full bg-secondary text-xs font-semibold">{index + 1}</div>
                  <div>
                    <b className="text-sm">{task.title ?? "Studio step"}</b>
                    <div className="text-sm text-tertiary">{task.detail ?? "Working"}</div>
                  </div>
                  <Badge type="pill-color" color={taskColor(task.status)} size="sm">
                    {task.status_label ?? statusLabel(task.status)}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </PageBody>
    </>
  );
}

function mergeProduction(previous: ProductionDetail | null, next: ProductionDetail): ProductionDetail {
  if (!previous) return next;
  const prior = new Map((previous.characters ?? []).map((character) => [character.id, character]));
  return {
    ...next,
    cover_url: next.cover_url ?? previous.cover_url,
    characters: (next.characters ?? []).map((character) => {
      const last = prior.get(character.id);
      const redesigning = !character.locked && !character.has_voice;
      return {
        ...character,
        still_url: character.still_url ?? last?.still_url ?? null,
        voice_url: redesigning ? character.voice_url : (character.voice_url ?? last?.voice_url ?? null),
        still_asset_id: character.still_asset_id ?? last?.still_asset_id ?? null,
        voice_asset_id: redesigning ? character.voice_asset_id : (character.voice_asset_id ?? last?.voice_asset_id ?? null),
      };
    }),
    assets: next.assets?.length ? next.assets : previous.assets,
    shoots: next.shoots?.length ? next.shoots : previous.shoots,
  };
}
