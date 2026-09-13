import { useState } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { DotsThree } from "@phosphor-icons/react";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { Tab, TabList, Tabs } from "@/components/base/tabs/tabs";
import { cx } from "@/utils/cx";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { CastSheet } from "@/components/drama/cast-sheet.tsx";
import { EpisodeStrip } from "@/components/drama/episode-strip.tsx";
import { Poster } from "@/components/drama/poster.tsx";
import { LoadError, ShowDetailSkeleton } from "@/components/drama/skeleton.tsx";
import { CTA, episodeStripStates, statusLabel } from "@/engine/present.ts";
import {
  BLOCK_SKUS,
  commissionLength,
  commissionSku,
  episodeSeconds,
  finishedRuntimeLabel,
  gapCharge,
  retailFor,
  runtimeLabel,
  skuLabel,
} from "@/lib/catalog.ts";
import { ApiError, studio } from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";

function money(amount: number) {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

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
  const [orderSku, setOrderSku] = useState<(typeof BLOCK_SKUS)[number]>(15);
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gap, setGap] = useState<{ needed: number; available: number; shortfall: number } | null>(null);
  const { data: billing } = useStudio("billing", () => studio.billing());
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
  const live =
    series.productions.find((row) => row.id === series.active_production_id) ??
    series.productions.find((row) => row.status === "awaiting_payment");
  const blocked = live?.status === "needs_user";

  const draftLength = commissionLength(series.episode_length ?? live?.episode_length);
  const draftTier = series.video_tier === "catalog" || live?.video_tier === "catalog" ? "catalog" : "pro";
  const draftSku = commissionSku(series.target_episode_count ?? live?.sku);
  const isDraft = !series.paid && (action === "pay_pilot" || action === "continue_draft");
  const retail = retailFor(draftSku, live?.priority === "fast" || live?.priority === "quality" ? live.priority : "balanced", draftLength, draftTier);
  const wallet = billing?.credit_balance ?? 0;
  const shortfall = gap?.shortfall ?? Math.max(0, Math.round((retail - wallet) * 100) / 100);
  const needsLoad = shortfall > 0.009;

  const startCheckout = async (sku: number) => {
    setBusy(true);
    setError(null);
    setGap(null);
    try {
      const created = await studio.createProduction({
        series_id: series.id,
        title: series.title,
        description: series.description ?? "",
        sku,
        priority: live?.priority ?? "balanced",
        episode_length: draftLength,
        video_tier: draftTier,
        mode: "autopilot",
      });
      window.location.href = `/productions/${created.id}`;
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 402) {
        setGap({
          needed: Number(caught.body.needed ?? retail),
          available: Number(caught.body.available ?? wallet),
          shortfall: Number(caught.body.shortfall ?? Math.max(0, retail - wallet)),
        });
        return;
      }
      setError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : "Could not start the run");
    } finally {
      setBusy(false);
    }
  };

  const loadToStart = async () => {
    setBusy(true);
    setError(null);
    try {
      const back = `/series/${series.id}`;
      const session = await studio.loadCredits(gapCharge(shortfall || retail - wallet), { success: back, cancel: back });
      window.location.href = session.url;
    } catch (caught) {
      setError(caught instanceof ApiError || caught instanceof Error ? caught.message : "Could not open checkout");
      setBusy(false);
    }
  };

  const discard = async () => {
    if (!window.confirm("Discard this draft? The brief is deleted. Unpaid drafts are also removed after 14 days.")) return;
    setDiscarding(true);
    setError(null);
    try {
      await studio.discardSeries(series.id);
      window.location.href = "/series";
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : "Could not discard the draft");
      setDiscarding(false);
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
    : isDraft
      ? "Draft"
      : live
        ? statusLabel(live.status, live.paused)
        : series.pilot_approved
          ? "Ready"
          : series.paid
            ? "Shooting"
            : "Draft";

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
          <>
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
            {!blocked && (action === "pay_pilot" || action === "continue_draft") ? (
              <>
                {needsLoad ? (
                  <Button color="primary" isDisabled={busy} onClick={() => void loadToStart()}>
                    {busy ? "Opening checkout…" : `Load ${money(gapCharge(shortfall))} to start`}
                  </Button>
                ) : (
                  <Button color="primary" isDisabled={busy} onClick={() => void startCheckout(draftSku)}>
                    {busy ? "Starting…" : `Start · ${money(retail)}`}
                  </Button>
                )}
                <Button href={`/new?draft=${series.id}`} color="secondary">
                  {CTA.editDraft}
                </Button>
                {series.can_discard !== false ? (
                  <Button color="tertiary" isDisabled={discarding} onClick={() => void discard()}>
                    {discarding ? "Discarding…" : CTA.discardDraft}
                  </Button>
                ) : null}
              </>
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
                <div className="flex flex-wrap items-center gap-1">
                  {BLOCK_SKUS.map((count) => (
                    <button
                      key={count}
                      type="button"
                      aria-pressed={orderSku === count}
                      aria-label={`${count} more episodes`}
                      className={cx(
                        "cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition duration-100 ease-linear ring-inset outline-focus-ring",
                        "focus-visible:outline-2 focus-visible:outline-offset-2",
                        orderSku === count
                          ? "bg-brand-solid text-white ring-transparent"
                          : "text-tertiary ring-secondary hover:text-secondary",
                      )}
                      onClick={() => setOrderSku(count)}
                    >
                      {count}
                    </button>
                  ))}
                </div>
                <Button color="primary" isDisabled={busy} onClick={() => void startCheckout(orderSku)}>
                  {busy ? "Starting checkout…" : `${CTA.orderMore} · ${skuLabel(orderSku)}`}
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
                <div className="absolute right-0 z-10 mt-2 w-56 rounded-xl bg-primary p-3 shadow-lg ring-1 ring-secondary ring-inset">
                  <div className="text-xs font-semibold text-tertiary">Show</div>
                  <div className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-tertiary">Target</span>
                      <b>{series.target_episode_count ?? draftSku} episodes</b>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-tertiary">Length</span>
                      <b>{runtimeLabel(episodeSeconds(draftLength))} each</b>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-tertiary">Picture</span>
                      <b>{draftTier === "catalog" ? "Catalog" : "Pro"}</b>
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
          </>
        }
      />
      <div className="bg-primary px-4 sm:px-8">
        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(key as (typeof TABS)[number]["id"])}>
          <TabList aria-label="Show sections">
            {TABS.map((item) => (
              <Tab key={item.id} id={item.id}>
                {item.label}
              </Tab>
            ))}
          </TabList>
        </Tabs>
      </div>
      <PageBody>
        {error ? <p className="mb-5 text-sm text-error-primary">{error}</p> : null}
        {isDraft ? (
          <div className="mb-6 rounded-xl bg-primary p-5 ring-1 ring-secondary ring-inset">
            <p className="text-sm font-semibold text-primary">Ready to start</p>
            <p className="mt-1 text-sm text-secondary">
              {skuLabel(draftSku)} · {runtimeLabel(episodeSeconds(draftLength))} each · {finishedRuntimeLabel(draftSku, draftLength)} finished
              {draftTier === "catalog" ? " · Catalog picture" : " · Pro picture"}
            </p>
            <div className="mt-4 flex items-baseline justify-between gap-3">
              <span className="text-sm text-tertiary">This run</span>
              <b className="figure text-lg font-semibold text-primary">{money(retail)}</b>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="text-tertiary">Wallet</span>
              <span className="figure text-secondary">{money(gap?.available ?? wallet)}</span>
            </div>
            {needsLoad ? (
              <p className="mt-3 text-sm text-secondary">
                Load {money(gapCharge(shortfall))} to start. Leftover stays in your wallet.
              </p>
            ) : (
              <p className="mt-3 text-sm text-secondary">Wallet covers this run. Start when you are ready.</p>
            )}
            {series.description ? <p className="mt-3 text-sm text-secondary">{series.description}</p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              {needsLoad ? (
                <Button color="primary" isDisabled={busy} onClick={() => void loadToStart()}>
                  {busy ? "Opening checkout…" : `Load ${money(gapCharge(shortfall))} to start`}
                </Button>
              ) : (
                <Button color="primary" isDisabled={busy} onClick={() => void startCheckout(draftSku)}>
                  {busy ? "Starting…" : `Start this show · ${money(retail)}`}
                </Button>
              )}
              <Button color="secondary" onClick={() => setTab("cast")}>
                Cast the show
              </Button>
              <Button href={`/new?draft=${series.id}`} color="tertiary">
                Change length or count
              </Button>
            </div>
            <p className="mt-3 text-xs text-tertiary">
              Cast anyone you like first and the story is written around them. Unpaid drafts are removed after 14 days.
            </p>
          </div>
        ) : null}

        {tab === "episodes" && isDraft ? null : tab === "episodes" ? (
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
                <p className="text-sm font-semibold">
                  {isDraft ? "Nothing shot yet." : series.paid ? "Episodes will appear as they are cut." : "Start the run to shoot the first episodes."}
                </p>
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

        {tab === "cast" ? <CastSheet seriesId={series.id} /> : null}

        {tab === "story" ? (
          bible?.logline || bibleCast.length || bible?.episode_structure?.length || locations.length || series.description ? (
            <div className="max-w-3xl space-y-5">
              <div className="rounded-xl border border-secondary bg-primary p-6">
                <h3 className="text-lg font-semibold">{bible?.title ?? series.title}</h3>
                <p className="mt-3 text-md text-secondary">{bible?.logline || series.description}</p>
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
              title={isDraft ? "No brief on this draft" : "Story appears after the pilot starts"}
              body={
                isDraft
                  ? "Edit the brief to put the story back, or discard the draft."
                  : series.paid
                    ? "The studio writes this while it shoots."
                    : "Start the pilot and come back."
              }
              href={isDraft ? `/new?draft=${series.id}` : series.paid ? productionHref : undefined}
              action={isDraft ? CTA.editDraft : undefined}
            />
          )
        ) : null}
      </PageBody>
    </>
  );
}

function EmptyShow({ title, body, href, action }: { title: string; body: string; href?: string; action?: string }) {
  return (
    <div className="ds-empty">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm text-tertiary">{body}</p>
      {href ? (
        <div className="mt-4">
          <Button href={href} color="secondary" size="sm">
            {action ?? CTA.watchLive}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
