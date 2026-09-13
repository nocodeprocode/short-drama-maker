import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { MediaRow } from "@/components/drama/media-row.tsx";
import { Poster } from "@/components/drama/poster.tsx";
import { LoadError, PosterGridSkeleton } from "@/components/drama/skeleton.tsx";
import { CTA, statusLabel } from "@/engine/present.ts";
import { studio } from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";

export default function Page() {
  const { data, error, reload } = useStudio("series", () => studio.series());
  const items = data?.items ?? [];

  if (error && !data) return <LoadError message={error} onRetry={() => void reload()} />;

  return (
    <>
      <PageHeader title="Shows" subtitle="Every season on this account." />
      <PageBody>
        {!data ? <PosterGridSkeleton /> : null}
        {data && items.length === 0 ? (
          <div className="ds-empty">
            <p className="text-sm font-semibold">No shows yet</p>
            <p className="mt-1 text-sm text-tertiary">{CTA.startPilot}. It will land here.</p>
          </div>
        ) : null}
        {items.length ? (
          <div className="flex flex-col gap-2 lg:grid lg:grid-cols-3 lg:gap-5 xl:grid-cols-5">
            {items.map((series) => (
              <div key={series.id}>
                <div className="lg:hidden">
                  <MediaRow
                    href={`/series/${series.id}`}
                    tone={series.poster_tone}
                    src={series.cover_url}
                    title={series.title}
                    detail={statusLabel(series.status)}
                  />
                </div>
                <a href={`/series/${series.id}`} className="hidden text-left transition-transform hover:-translate-y-0.5 lg:block">
                  <Poster tone={series.poster_tone} src={series.cover_url} title={series.title} />
                  <div className="mt-2.5 text-sm font-semibold">{series.title}</div>
                  <div className="text-xs text-tertiary">{statusLabel(series.status)}</div>
                </a>
              </div>
            ))}
          </div>
        ) : null}
      </PageBody>
    </>
  );
}
