import { useMemo, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { Tab, TabList, Tabs } from "@/components/base/tabs/tabs";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { MediaRow } from "@/components/drama/media-row.tsx";
import { Poster } from "@/components/drama/poster.tsx";
import { CTA, statusBadgeColor, statusLabel } from "@/engine/present.ts";
import { LoadError, PosterGridSkeleton } from "@/components/drama/skeleton.tsx";
import { studio, type Production } from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";
import { cx } from "@/utils/cx";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "running", label: "Shooting" },
  { id: "needs_user", label: "Needs you" },
  { id: "ready", label: "Ready" },
] as const;

function matches(run: Production, filter: string) {
  if (filter === "all") return true;
  if (filter === "needs_user") return run.status === "needs_user";
  if (filter === "ready") return run.status === "ready";
  if (filter === "running") return run.status === "queued" || run.status === "running";
  return true;
}

function latestPerSeries(items: Production[]) {
  const map = new Map<string, Production>();
  for (const item of items) {
    const previous = map.get(item.series_id);
    if (!previous || previous.updated_at < item.updated_at) map.set(item.series_id, item);
  }
  return [...map.values()];
}

export default function Page() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const { data, error, reload } = useStudio("productions", () => studio.productions());
  const grouped = useMemo(() => latestPerSeries(data?.items ?? []), [data]);
  const counts = {
    all: grouped.length,
    running: grouped.filter((item) => matches(item, "running")).length,
    needs_user: grouped.filter((item) => matches(item, "needs_user")).length,
    ready: grouped.filter((item) => matches(item, "ready")).length,
  };
  const items = grouped.filter((item) => matches(item, filter));

  if (error && !data) return <LoadError message={error} onRetry={() => void reload()} />;

  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle="A paid job happening to a show. Open a card to watch live."
        actions={
          <Button href="/new" color="primary">
            {CTA.newShow}
          </Button>
        }
      />
      <div className="bg-primary px-4 sm:px-8">
        <Tabs selectedKey={filter} onSelectionChange={(key) => setFilter(key as (typeof FILTERS)[number]["id"])}>
          <TabList aria-label="Filter jobs">
            {FILTERS.map((tab) => (
              <Tab key={tab.id} id={tab.id} badge={counts[tab.id]}>
                {tab.label}
              </Tab>
            ))}
          </TabList>
        </Tabs>
      </div>
      <PageBody>
        {!data ? <PosterGridSkeleton cols="jobs" count={4} /> : null}
        {data ? (
          <div className="flex flex-col gap-2 lg:grid lg:grid-cols-3 lg:gap-5 xl:grid-cols-4">
            {items.map((run) => (
              <div key={run.id}>
                <div className="lg:hidden">
                  <MediaRow
                    href={`/productions/${run.id}`}
                    tone={run.poster_tone}
                    src={run.cover_url}
                    title={run.series_title ?? "Show"}
                    detail={run.headline ?? statusLabel(run.status, run.paused)}
                    trailing={
                      <Badge type="pill-color" color={statusBadgeColor(run.status, run.paused)} size="sm">
                        {statusLabel(run.status, run.paused)}
                      </Badge>
                    }
                  />
                </div>
                <a href={`/productions/${run.id}`} className="hidden text-left transition-transform hover:-translate-y-0.5 lg:block">
                  <Poster
                    tone={run.poster_tone}
                    src={run.cover_url}
                    title={`${run.series_title ?? "Show"} · ${run.sku === "2" ? "Pilot" : `E${run.episode_start}–${run.episode_end}`}`}
                    progress={run.progress ?? (run.status === "ready" ? 100 : 24)}
                  />
                  <div className="mt-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-sm font-semibold">{run.series_title}</div>
                      <Badge type="pill-color" color={statusBadgeColor(run.status, run.paused)} size="sm">
                        {statusLabel(run.status, run.paused)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-tertiary">{run.headline ?? run.agent_decision ?? "Preparing this show."}</div>
                  </div>
                </a>
              </div>
            ))}
          </div>
        ) : null}
        {data && items.length === 0 && !error ? (
          <div className="ds-empty">
            <p className="text-sm font-semibold">Nothing in this view</p>
            <p className="mt-1 text-sm text-tertiary">
              {filter === "ready"
                ? "Finished episodes land here when a job completes."
                : filter === "needs_user"
                  ? "We only stop here when we need a decision from you."
                  : CTA.startPilot}
            </p>
          </div>
        ) : null}
      </PageBody>
    </>
  );
}
