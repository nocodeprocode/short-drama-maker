import { useState } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { DownloadSimple } from "@phosphor-icons/react";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { EpisodeCut } from "@/components/drama/episode-cut.tsx";
import { EpisodeSkeleton, LoadError } from "@/components/drama/skeleton.tsx";
import {
  CTA,
  downloadBasename,
  formatClock,
  playableShotUrls,
  statusBadgeColor,
  statusLabel,
} from "@/engine/present.ts";
import { studio } from "@/lib/api.ts";
import { downloadMedia } from "@/lib/media.ts";
import { useStudio } from "@/lib/use-studio.ts";

export default function Page() {
  const id = usePageContext().routeParams.id;
  const { data: episode, error, reload } = useStudio(`episode:${id}`, () => studio.episode(id), [id]);
  const [downloading, setDownloading] = useState(false);

  if (error && !episode) return <LoadError message={error} onRetry={() => void reload()} />;
  if (!episode) return <EpisodeSkeleton />;

  const complete = episode.status === "complete";
  const files = playableShotUrls(episode.shots);
  const duration = episode.duration_seconds ? formatClock(episode.duration_seconds) : null;

  const download = async () => {
    setDownloading(true);
    const base = downloadBasename(episode.series_title, episode.episode_number);
    try {
      if (episode.final_url) {
        await downloadMedia(episode.final_url, `${base}.mp4`);
      } else {
        for (const file of files) {
          await downloadMedia(file.url, files.length === 1 ? `${base}.mp4` : `${base}-shot-${String(file.position).padStart(2, "0")}.mp4`);
        }
      }
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={episode.series_title}
        title={`Episode ${episode.episode_number}`}
        subtitle={episode.title}
        actions={
          <Badge type="pill-color" color={statusBadgeColor(episode.status)} size="sm">
            {statusLabel(episode.status)}
          </Badge>
        }
      />
      <PageBody>
        <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,360px)_1fr]">
          <EpisodeCut shots={episode.shots} tone={episode.poster_tone} finalUrl={episode.final_url} />
          <div className="rounded-xl border border-secondary bg-primary p-6">
            <p className="text-sm text-secondary">
              {complete
                ? episode.final_url
                  ? `Assembled episode ready${duration ? ` · ${duration}` : ""}.`
                  : files.length
                    ? `${files.length} shots play in order${duration ? ` · ${duration}` : ""}. This is the cut.`
                    : "No takes yet."
                : "Autopilot is cutting this. You can leave."}
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {complete && files.length ? (
                <Button color="primary" iconLeading={DownloadSimple} isDisabled={downloading} onClick={() => void download()}>
                  {downloading ? "Downloading…" : CTA.downloadMp4}
                </Button>
              ) : null}
              <Button href={`/episodes/${id}/studio`} color={complete ? "secondary" : "primary"}>
                {CTA.openTimeline}
              </Button>
            </div>
            {episode.production_id ? (
              <div className="mt-4">
                <Button href={`/productions/${episode.production_id}`} color="link-gray" size="sm">
                  Back to the job
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </PageBody>
    </>
  );
}
