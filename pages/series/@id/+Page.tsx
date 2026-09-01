import { useState } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { DotsThree } from "@phosphor-icons/react";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { CastCard } from "@/components/drama/cast-card.tsx";
import { EpisodeStrip } from "@/components/drama/episode-strip.tsx";
import { Poster } from "@/components/drama/poster.tsx";
import { LoadError, ShowDetailSkeleton } from "@/components/drama/skeleton.tsx";
import { CTA, episodeStripStates, statusLabel } from "@/engine/present.ts";
import { ApiError, studio } from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";

const TABS = [
  { id: "episodes", label: "Episodes" },
  { id: "cast", label: "Cast" },
  { id: "story", label: "Story" },
] as const;

export default function Page() {
  const id = usePageContext().routeParams.id;
  const { data, error: loadError, reload } = useStudio(
    `series:${id}`,
    async () => {
      const [series, episodes] = await Promise.all([studio.seriesOne(id), studio.seriesEpisodes(id)]);
      return { series, episodes: episodes.items };
    },
    [id],
  );
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("episodes");
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const series = data?.series;
  const episodes = data?.episodes ?? [];

  if (loadError && !series) return <LoadError message={loadError} onRetry={() => void reload()} />;
  if (!series) return <ShowDetailSkeleton />;

  const action = series.next_action ?? (series.paid ? "open_production" : "pay_pilot");
  const productionHref = series.active_production_id ? `/productions/${series.active_production_id}` : "/series";
  const bible = series.story_bible;
  const locations = bible?.locations ?? [];
  const bibleCast = bible?.characters ?? [];
  const firstReady = episodes.find((episode) => episode.status === "complete");
  const live = series.productions.find((row) => row.id === series.active_production_id);
  const blocked = live?.status === "needs_user";

  const startCheckout = async (sku: number) => {
    setBusy(true);
    setError(null);
    try {
      const created = await studio.createProduction({
        series_id: series.id,
        title: series.title,
        description: series.description ?? "",
        sku,
        priority: "balanced",
        episode_length: "60_90",
        mode: "autopilot",
      });
      if (created.checkout?.url) {
        window.location.href = created.checkout.url;
        return;
      }
      window.location.href = `/productions/${created.id}`;
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : "Could not start checkout");
    } finally {
      setBusy(false);
    }
  };

  const approve = () => {
    setBusy(true);
    studio
      .approvePilot(series.id)
      .then(reload)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not approve"))
      .finally(() => setBusy(false));
  };

  const statusText = blocked
    ? "Needs you"
    : live
      ? statusLabel(live.status, live.paused)
      : series.pilot_approved
        ? "Ready"
        : series.paid
          ? "Shooting"
          : "Waiting for payment";

  return (
    <>
      <PageHeader
        eyebrow="Show"
        title={series.title}
        subtitle={
          <span className="text-sm text-secondary">
            {statusText}
            {series.episode_count ? ` · ${series.episode_count} episodes` : ""}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {blocked && live ? (
              <>
                {live.intervention_type === "quality_budget" ? (
                  <Button color="primary" isDisabled={busy} onClick={() => studio.useBest(live.id).then(reload)}>
                    {CTA.useBest}
                  </Button>
                ) : (
                  <Button color="primary" isDisabled={busy} onClick={() => studio.resume(live.id).then(reload)}>
                    {CTA.retry}
                  </Button>
                )}
                <Button href={productionHref} color="secondary">
                  Open the shot
                </Button>
              </>
            ) : null}
            {!blocked && action === "pay_pilot" ? (
              <Button color="primary" isDisabled={busy} onClick={() => void startCheckout(2)}>
                {busy ? "Starting checkout…" : CTA.startThePilot}
              </Button>
            ) : null}
            {!blocked && action === "open_production" ? (
              <>
                <Button href={productionHref} color="primary">
                  {CTA.watchLive}
                </Button>
                {live && !live.paused && (live.status === "running" || live.status === "queued") ? (
                  <Button color="secondary" onClick={() => studio.pause(live.id).then(reload)}>
                    Pause
                  </Button>
                ) : null}
              </>
            ) : null}
            {!blocked && action === "approve_pilot" ? (
              <>
                {firstReady ? (
                  <Button href={`/episodes/${firstReady.id}`} color="primary">
                    {CTA.watchEpisode(firstReady.episode_number)}
                  </Button>
                ) : (
                  <Button href={productionHref} color="primary">
                    {CTA.watchLive}
                  </Button>
                )}
                <Button color="secondary" isDisabled={busy} onClick={approve}>
                  {CTA.approveCast}
                </Button>
              </>
            ) : null}
            {!blocked && action === "buy_next_block" ? (
              <>
                <Button color="primary" isDisabled={busy} onClick={() => void startCheckout(12)}>
                  {busy ? "Starting checkout…" : CTA.orderMore}
                </Button>
                {episodes.some((episode) => episode.status === "complete") ? (
                  <Button href={`/series/${id}/export`} color="secondary">
                    Export
                  </Button>
                ) : null}
              </>
            ) : null}
            <div className="relative">
              <Button color="tertiary" aria-label="More" onClick={() => setMenu((value) => !value)}>
                <DotsThree size={20} />
              </Button>
              {menu ? (
                <div className="absolute right-0 z-10 mt-2 w-56 rounded-xl border border-secondary bg-primary p-3 shadow-lg">
                  <div className="text-xs font-semibold text-tertiary">Show</div>
                  <div className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-tertiary">Target</span>
                      <b>{series.target_episode_count ?? 60} episodes</b>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-tertiary">Pilot</span>
                      <b>{series.paid ? "Paid" : "Not paid"}</b>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-tertiary">Cast</span>
                      <b>{series.pilot_approved ? "Approved" : "After you watch"}</b>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        }
      />
      <div className="border-b border-secondary bg-primary px-4 sm:px-8">
        <div className="flex gap-1">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`border-b-2 px-3 py-2.5 text-sm font-semibold ${tab === item.id ? "border-brand-600 text-brand-700" : "border-transparent text-tertiary"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <PageBody>
        {error ? <p className="mb-5 text-sm text-error-primary">{error}</p> : null}

        {tab === "episodes" ? (
          <>
            <div className="mb-4 flex items-baseline gap-3">
              <h3 className="text-lg font-semibold">Episodes</h3>
              <span className="text-sm text-tertiary">{series.episode_count} produced</span>
            </div>
            <EpisodeStrip
              start={1}
              end={Math.max(series.episode_count, live ? live.episode_end : 2)}
              states={episodeStripStates(episodes)}
              hrefs={Object.fromEntries(
                episodes.filter((episode) => episode.status === "complete").map((episode) => [episode.episode_number, `/episodes/${episode.id}`]),
              )}
            />
            {episodes.length ? (
              <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
                {episodes.map((episode) => (
                  <a key={episode.id} href={`/episodes/${episode.id}`} className="text-left">
                    <Poster
                      tone={episode.poster_tone || series.poster_tone}
                      src={episode.cover_url}
                      chip={`EP ${String(episode.episode_number).padStart(2, "0")}`}
                      title={episode.title}
                      progress={episode.status === "complete" ? undefined : 40}
                    />
                    <div className="mt-2 text-sm font-semibold">Episode {episode.episode_number}</div>
                    <div className="text-xs text-tertiary">{statusLabel(episode.status)}</div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="ds-empty mt-8">
                <p className="text-sm font-semibold">{series.paid ? "Episodes will appear as they are cut." : "Pay for the pilot to start."}</p>
                {series.paid && series.active_production_id ? (
                  <div className="mt-4">
                    <Button href={productionHref} color="secondary" size="sm">
                      {CTA.watchLive}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </>
        ) : null}

        {tab === "cast" ? (
          series.characters.length ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {series.characters.map((character) => (
                <CastCard
                  key={character.id}
                  href={`/characters/${character.id}`}
                  name={character.name}
                  description={character.description}
                  stillUrl={character.still_url}
                  refs={character.refs}
                  locked={character.locked}
                  actorName={character.actor_name}
                />
              ))}
            </div>
          ) : (
            <EmptyShow
              title="Cast appears after the pilot starts"
              body={series.paid ? "Faces and voices are generated while the show is shooting." : "Start the pilot to cast the show."}
              href={series.paid ? productionHref : undefined}
            />
          )
        ) : null}

        {tab === "story" ? (
          bible?.logline || bibleCast.length || bible?.episode_structure?.length || locations.length ? (
            <div className="max-w-3xl space-y-5">
              <div className="rounded-xl border border-secondary bg-primary p-6">
                <h3 className="text-lg font-semibold">{bible?.title ?? series.title}</h3>
                <p className="mt-3 text-md text-secondary">{bible?.logline}</p>
              </div>
              {bibleCast.length ? (
                <div className="rounded-xl border border-secondary bg-primary p-6">
                  <h3 className="text-lg font-semibold">Cast</h3>
                  <ul className="mt-3 space-y-3">
                    {bibleCast.map((character) => (
                      <li key={character.name}>
                        <div className="text-sm font-semibold">{character.name}</div>
                        <p className="text-sm text-tertiary">{character.description ?? character.role ?? ""}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {locations.length ? (
                <div className="rounded-xl border border-secondary bg-primary p-6">
                  <h3 className="text-lg font-semibold">Places that repeat</h3>
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-secondary">
                    {locations.map((location) => (
                      <li key={location}>{location}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {bible?.episode_structure?.length ? (
                <div className="rounded-xl border border-secondary bg-primary p-6">
                  <h3 className="text-lg font-semibold">Season shape</h3>
                  <ol className="mt-3 space-y-2">
                    {bible.episode_structure.map((episode) => (
                      <li key={episode.episode_number} className="text-sm">
                        <b>Episode {episode.episode_number}</b> {episode.title}
                        {episode.hook ? <span className="text-tertiary"> — {episode.hook}</span> : null}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyShow
              title="Story appears after the pilot starts"
              body={series.paid ? "The studio writes this while it shoots." : "Start the pilot and come back."}
              href={series.paid ? productionHref : undefined}
            />
          )
        ) : null}
      </PageBody>
    </>
  );
}

function EmptyShow({ title, body, href }: { title: string; body: string; href?: string }) {
  return (
    <div className="ds-empty">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm text-tertiary">{body}</p>
      {href ? (
        <div className="mt-4">
          <Button href={href} color="secondary" size="sm">
            {CTA.watchLive}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
