import { useState } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { DownloadSimple } from "@phosphor-icons/react";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { Poster } from "@/components/drama/poster.tsx";
import { CardListSkeleton, LoadError } from "@/components/drama/skeleton.tsx";
import { CTA, downloadBasename, playableShotUrls, statusBadgeColor, statusLabel } from "@/engine/present.ts";
import { studio, type Episode, type EpisodeDetail } from "@/lib/api.ts";
import { downloadMedia } from "@/lib/media.ts";
import { useStudio } from "@/lib/use-studio.ts";

export default function Page() {
  const id = usePageContext().routeParams.id;
  const { data, error, reload } = useStudio(
    `series-export:${id}`,
    async () => {
      const [series, episodes] = await Promise.all([studio.seriesOne(id), studio.seriesEpisodes(id)]);
      return { series, episodes: episodes.items };
    },
    [id],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const series = data?.series;
  const episodes = data?.episodes ?? [];
  const ready = episodes.filter((episode) => episode.status === "complete");
  const shooting = episodes.filter((episode) => episode.status !== "complete");

  const downloadEpisode = async (episode: Episode) => {
    setBusy(episode.id);
    try {
      const detail: EpisodeDetail = await studio.episode(episode.id);
      const files = playableShotUrls(detail.shots);
      const base = downloadBasename(series?.title ?? detail.series_title, episode.episode_number);
      for (const file of files) {
        await downloadMedia(
          file.url,
          files.length === 1 ? `${base}.mp4` : `${base}-shot-${String(file.position).padStart(2, "0")}.mp4`,
        );
      }
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) return <LoadError message={error} onRetry={() => void reload()} />;

  return (
    <>
      <PageHeader
        eyebrow={series?.title}
        title="Download episodes"
        subtitle={
          !data
            ? "Opening downloads…"
            : shooting.length && ready.length
              ? `Episode ${ready.map((episode) => episode.episode_number).join(", ")} ready · Episode ${shooting.map((episode) => episode.episode_number).join(", ")} still shooting`
              : ready.length
                ? `${ready.length} episode${ready.length === 1 ? "" : "s"} ready`
                : "No finished episodes yet"
        }
        actions={
          <Button href={`/series/${id}`} color="secondary">
            Back to show
          </Button>
        }
      />
      <PageBody>
        {!data ? <CardListSkeleton count={2} /> : null}
        {data && episodes.length === 0 ? (
          <div className="ds-empty">
            <p className="text-sm font-semibold">Nothing to download yet</p>
            <p className="mt-1 text-sm text-tertiary">Come back when an episode is ready.</p>
          </div>
        ) : null}
        {episodes.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {episodes.map((episode) => {
              const done = episode.status === "complete";
              return (
                <div key={episode.id} className="rounded-xl border border-secondary bg-primary p-4">
                  <div className="flex gap-4">
                    <div className="w-20 shrink-0">
                      <Poster tone={episode.poster_tone || series?.poster_tone} src={episode.cover_url} chip={`EP ${String(episode.episode_number).padStart(2, "0")}`} />
                    </div>
                    <div className="min-w-0 grow">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-semibold">Episode {episode.episode_number}</div>
                        <Badge type="pill-color" color={statusBadgeColor(episode.status)} size="sm">
                          {statusLabel(episode.status)}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-tertiary">{episode.title}</p>
                      {done ? (
                        <Button
                          color="primary"
                          size="sm"
                          className="mt-3"
                          iconLeading={DownloadSimple}
                          isDisabled={busy === episode.id}
                          onClick={() => void downloadEpisode(episode)}
                        >
                          {busy === episode.id ? "Downloading…" : CTA.downloadMp4}
                        </Button>
                      ) : (
                        <p className="mt-3 text-xs text-tertiary">Still shooting</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </PageBody>
    </>
  );
}
