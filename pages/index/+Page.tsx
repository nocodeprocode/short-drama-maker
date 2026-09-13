import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { EpisodeStrip } from "@/components/drama/episode-strip.tsx";
import { Poster } from "@/components/drama/poster.tsx";
import {
  CTA,
  greetingName,
  homeShows,
  isLiveShowStatus,
  statusBadgeColor,
  statusLabel,
  type HomeShow,
} from "@/engine/present.ts";
import { MediaRow } from "@/components/drama/media-row.tsx";
import { HomeSkeleton, LoadError } from "@/components/drama/skeleton.tsx";
import { studio } from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";

export default function Page() {
  const { data: home, error, reload } = useStudio("home", () => studio.home());

  if (error && !home) return <LoadError message={error} onRetry={() => void reload()} />;
  if (!home) return <HomeSkeleton />;

  const shows = homeShows(home);
  if (shows.length === 0) return <EmptyHome />;

  const name = greetingName(home.display_name);
  const lead = shows.find((show) => isLiveShowStatus(show.status, show.paused));
  const rest = lead ? shows.filter((show) => show.id !== lead.id) : shows;

  return (
    <>
      <PageHeader title={name ? `Welcome back, ${name}` : "Welcome back"} subtitle={home.status_sentence} />
      <PageBody>
        {lead ? <ShowHero show={lead} /> : null}

        {rest.length ? (
          <section>
            <div className="mb-4 flex items-baseline gap-3">
              <h3 className="text-lg font-semibold">Your shows</h3>
              <span className="text-sm text-tertiary">{rest.length}</span>
            </div>
            <div className="flex flex-col gap-2 lg:grid lg:grid-cols-3 lg:gap-4 xl:grid-cols-6">
              {rest.map((show) => (
                <ShowCard key={show.id} show={show} />
              ))}
            </div>
          </section>
        ) : lead ? null : (
          <section>
            <div className="mb-4 flex items-baseline gap-3">
              <h3 className="text-lg font-semibold">Your shows</h3>
              <span className="text-sm text-tertiary">{shows.length}</span>
            </div>
            <div className="flex flex-col gap-2 lg:grid lg:grid-cols-3 lg:gap-4 xl:grid-cols-6">
              {shows.map((show) => (
                <ShowCard key={show.id} show={show} />
              ))}
            </div>
          </section>
        )}
      </PageBody>
    </>
  );
}

function EmptyHome() {
  return (
    <PageBody className="flex min-h-[60vh] flex-col justify-center">
      <div className="mx-auto max-w-xl text-center">
        <h1 className="font-display text-display-sm font-semibold tracking-tight">Your studio is ready</h1>
        <p className="mt-3 text-md text-secondary">
          Pick a season size. We write, cast, shoot, and cut. You watch episodes as they land.
        </p>
        <div className="mt-6">
          <Button href="/new" color="primary" size="lg">
            {CTA.startPilot}
          </Button>
        </div>
        <p className="mt-5 text-sm text-tertiary">
          15 to 90 episodes at 60, 90, or 120 seconds.
          <br />
          You can leave this page. We only stop if we need you.
        </p>
      </div>
    </PageBody>
  );
}

function ShowHero({ show }: { show: HomeShow }) {
  const shooting = !show.paused && (show.status === "running" || show.status === "queued");
  return (
    <div className="mb-8 flex flex-col gap-4 rounded-xl bg-primary p-4 ring-1 ring-secondary ring-inset sm:flex-row sm:items-center sm:p-5">
      <div className="w-14 shrink-0 sm:w-16">
        <Poster tone={show.poster_tone} src={show.cover_url} progress={show.progress} />
      </div>
      <div className="min-w-0 grow">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{show.title}</h2>
          <Badge type="pill-color" color={statusBadgeColor(show.status, show.paused)} size="sm">
            {statusLabel(show.status, show.paused)}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-secondary">{showCopy(show)}</p>
        {show.episode_end > 1 || show.ready_count > 0 ? (
          <div className="mt-3">
            <EpisodeStrip start={show.episode_start} end={show.episode_end} states={stripStates(show)} />
          </div>
        ) : null}
        {show.progress != null ? (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, show.progress)}%` }} />
          </div>
        ) : null}
      </div>
      <Button href={show.href} color="primary" size="sm">
        {show.status === "needs_user" ? "Open show" : shooting ? CTA.watchLive : "Open show"}
      </Button>
    </div>
  );
}

function ShowCard({ show }: { show: HomeShow }) {
  return (
    <div>
      <div className="lg:hidden">
        <MediaRow href={show.href} tone={show.poster_tone} src={show.cover_url} title={show.title} detail={showCopy(show)} />
      </div>
      <a href={show.href} className="hidden text-left transition-transform hover:-translate-y-0.5 lg:block">
        <Poster tone={show.poster_tone} src={show.cover_url} title={show.title} progress={show.progress} />
        <div className="mt-2.5 text-sm font-semibold">{show.title}</div>
        <div className="text-xs text-tertiary">{showCopy(show)}</div>
      </a>
    </div>
  );
}

function showCopy(show: HomeShow): string {
  if (show.headline) return show.headline;
  if (show.status === "needs_user") return "This show needs you.";
  if (show.paused) return "Paused. Resume when you want it to continue.";
  if (show.status === "running" || show.status === "queued") {
    return show.ready_count ? `Shooting · ${show.ready_count} episode${show.ready_count === 1 ? "" : "s"} ready` : "Shooting. You can leave.";
  }
  if (show.status === "ready") {
    return show.ready_count ? `${show.ready_count} episode${show.ready_count === 1 ? "" : "s"} ready` : "Ready";
  }
  return statusLabel(show.status, show.paused);
}

function stripStates(show: HomeShow): Record<number, string> {
  const states: Record<number, string> = {};
  for (let n = show.episode_start; n <= show.episode_end; n += 1) {
    if (n <= show.ready_count + show.episode_start - 1) states[n] = "done";
    else if (isLiveShowStatus(show.status, show.paused)) states[n] = "gen";
  }
  return states;
}
