import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
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
      <PageHeader title="Shows" subtitle="Every show you have in the studio." />
      <PageBody>
        {!data ? <PosterGridSkeleton /> : null}
        {data && items.length === 0 ? (
          <div className="ds-empty">
            <p className="text-sm font-semibold">No shows yet</p>
            <p className="mt-1 text-sm text-tertiary">{CTA.startPilot}. It will appear here.</p>
          </div>
        ) : null}
        {items.length ? (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 xl:grid-cols-5">
            {items.map((series) => (
              <a key={series.id} href={`/series/${series.id}`} className="text-left transition-transform hover:-translate-y-0.5">
                <Poster tone={series.poster_tone} src={series.cover_url} title={series.title} />
                <div className="mt-2.5 text-sm font-semibold">{series.title}</div>
                <div className="text-xs text-tertiary">{statusLabel(series.status)}</div>
              </a>
            ))}
          </div>
        ) : null}
      </PageBody>
    </>
  );
}
