import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { Poster } from "@/components/drama/poster.tsx";
import { LoadError, PosterGridSkeleton } from "@/components/drama/skeleton.tsx";
import { studio } from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";

export default function Page() {
  const { data, error, reload } = useStudio("series", () => studio.series());
  const items = data?.items ?? [];

  if (error && !data) return <LoadError message={error} onRetry={() => void reload()} />;

  return (
    <>
      <PageHeader title="Export" subtitle="Pick a show with a finished episode." />
      <PageBody>
        {!data ? <PosterGridSkeleton /> : null}
        {data && items.length === 0 ? (
          <div className="ds-empty">
            <p className="text-sm font-semibold">Nothing to download yet</p>
            <p className="mt-1 text-sm text-tertiary">Export appears after an episode is ready.</p>
          </div>
        ) : null}
        {items.length ? (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 xl:grid-cols-5">
            {items.map((series) => (
              <a key={series.id} href={`/series/${series.id}/export`} className="text-left">
                <Poster tone={series.poster_tone} src={series.cover_url} title={series.title} />
                <div className="mt-2 text-sm font-semibold">{series.title}</div>
              </a>
            ))}
          </div>
        ) : null}
      </PageBody>
    </>
  );
}
