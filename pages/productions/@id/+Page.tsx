import { useEffect, useMemo, useRef, useState } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { Pause, Play, XCircle } from "@phosphor-icons/react";
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
import { ApiError, studio, type ProductionDetail } from "@/lib/api.ts";
import { readCache, writeCache } from "@/lib/cache.ts";
import { useLiveReload, useSessionReady, useStudio } from "@/lib/use-studio.ts";

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
  const { data: account } = useStudio("account", () => studio.account());
  const [paying, setPaying] = useState(false);
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
  const canResume = run.paused && run.status !== "awaiting_payment" && run.status !== "cancelled";
  const canCancel = !ready && run.status !== "cancelled";
  const unpaidDraft = run.status === "awaiting_payment" && Number(run.paid_amount ?? 0) <= 0;
  const cancel = () => {
    if (unpaidDraft) {
      if (!window.confirm("Discard this unpaid draft? The brief is deleted. Unpaid drafts are also removed after 14 days.")) return;
      studio
        .discardSeries(run.series_id)
        .then(() => {
          window.location.href = "/series";
        })
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not discard the draft"));
      return;
    }
    if (!window.confirm("Cancel this production? Finished takes stay on the show and unused credit stays on your balance.")) return;
    studio
      .cancel(run.id)
      .then(reload)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not cancel"));
  };
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
            {canCancel ? (
              <Button color="tertiary" iconLeading={XCircle} onClick={cancel}>
                {unpaidDraft ? CTA.discardDraft : "Cancel"}
              </Button>
            ) : null}
            {watch.map((link) => (
              <Button key={link.href} href={link.href} color={ready ? "primary" : "secondary"}>
                {link.label}
              </Button>
            ))}
            {run.status === "awaiting_payment" ? (
              <>
                <Button
                  color="primary"
                  isDisabled={paying}
                  onClick={() => {
                    setPaying(true);
                    const sku = Number(run.sku);
                    studio
                      .createProduction({
                        series_id: run.series_id,
                        sku: Number.isFinite(sku) && sku > 0 ? sku : 2,
                        priority: run.priority,
                        episode_length: run.episode_length,
                        video_tier: run.video_tier ?? "pro",
                        mode: run.mode === "studio" ? "studio" : "autopilot",
                      })
                      .then((created) => {
                        window.location.href = `/productions/${created.id}`;
                      })
                      .catch((caught) => {
                        setPaying(false);
                        if (caught instanceof ApiError && caught.status === 402) {
                          window.location.href = "/account/billing";
                          return;
                        }
                        setError(caught instanceof Error ? caught.message : "Could not start the run");
                      });
                  }}
                >
                  {paying ? "Starting…" : CTA.payAgain}
                </Button>
                {account?.is_admin ? (
                  <Button
                    color="tertiary"
                    onClick={() =>
                      studio
                        .confirmTest(run.id)
                        .then(reload)
                        .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not confirm"))
                    }
                  >
                    Confirm test
                  </Button>
                ) : null}
              </>
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
          <div className="mb-5 rounded-xl border border-brand bg-brand-primary_alt px-4 py-3 text-sm">
            Payment received. The studio started. You can leave this page.
          </div>
        ) : null}

        {ready ? null : (
          <div className="mb-5 rounded-xl bg-primary p-5 ring-1 ring-secondary ring-inset">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="font-display text-lg font-semibold">{working?.title ?? run.headline ?? "Preparing this show"}</h2>
                <p className="mt-1 text-sm text-secondary">{working?.detail ?? "You can close this page."}</p>
              </div>
              <div className="shrink-0 text-right">
                <div className="figure text-md font-semibold text-primary">
                  Episode {Math.min(doneEpisodes + 1, totalEpisodes)} of {totalEpisodes}
                </div>
                <div className="figure mt-0.5 text-sm text-tertiary">
                  {typeof run.spent === "number" ? `$${run.spent.toFixed(2)} spent · ` : ""}
                  ${Number(run.balance ?? 0).toFixed(2)} left
                </div>
              </div>
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
          <div className="mb-5 rounded-xl bg-success-primary p-5 ring-1 ring-success-secondary ring-inset">
            <h2 className="font-display text-lg font-semibold">Ready to watch</h2>
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
          <div className="mt-5 overflow-hidden rounded-xl bg-primary ring-1 ring-secondary ring-inset">
            <div className="border-b border-secondary px-6 py-4">
              <h3 className="text-md font-semibold">What just happened</h3>
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
