import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { Poster } from "@/components/drama/poster.tsx";
import { CardListSkeleton, LoadError } from "@/components/drama/skeleton.tsx";
import { CTA, statusBadgeColor, statusLabel } from "@/engine/present.ts";
import { studio } from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";

export default function Page() {
  const { data, error, reload } = useStudio("needs", () => studio.productions("needs_user"));
  const items = data?.items ?? [];

  if (error && !data) return <LoadError message={error} onRetry={() => void reload()} />;

  return (
    <>
      <PageHeader title="Needs you" subtitle="We only stop when the studio cannot decide." />
      <PageBody className="max-w-[900px]">
        {!data ? <CardListSkeleton /> : null}
        {items.map((run) => (
          <div
            key={run.id}
            className={`mb-5 flex gap-4 rounded-2xl border p-6 ${run.intervention_type === "content_policy" ? "border-secondary bg-primary" : "border-warning-200 bg-warning-50"}`}
          >
            <div className="w-18 shrink-0">
              <Poster tone={run.poster_tone} src={run.cover_url} />
            </div>
            <div className="grow">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{run.series_title}</div>
                  <h3 className="mt-1 text-lg font-semibold">{run.agent_decision ?? "This show needs a decision."}</h3>
                </div>
                <Badge type="pill-color" color={statusBadgeColor(run.status)} size="sm">
                  {statusLabel(run.status)}
                </Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {run.intervention_type === "quality_budget" ? (
                  <Button color="primary" onClick={() => studio.useBest(run.id).then(() => void reload())}>
                    {CTA.useBest}
                  </Button>
                ) : null}
                {run.intervention_type === "technical" ? (
                  <Button color="primary" onClick={() => studio.resume(run.id).then(() => void reload())}>
                    {CTA.retry}
                  </Button>
                ) : null}
                <Button href={`/productions/${run.id}`} color="secondary">
                  Open show
                </Button>
              </div>
            </div>
          </div>
        ))}
        {data && items.length === 0 ? <p className="text-sm text-tertiary">Nothing is waiting for you.</p> : null}
      </PageBody>
    </>
  );
}
