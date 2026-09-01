import { usePageContext } from "vike-react/usePageContext";
import { Badge } from "@/components/base/badges/badges";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { CharacterPack } from "@/components/drama/cast-card.tsx";
import { AccountSkeleton, LoadError } from "@/components/drama/skeleton.tsx";
import { studio } from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";

export default function Page() {
  const id = usePageContext().routeParams.id;
  const { data: actor, error, reload } = useStudio(`actor:${id}`, () => studio.actor(id), [id]);

  if (error && !actor) return <LoadError message={error} onRetry={() => void reload()} />;
  if (!actor) return <AccountSkeleton />;

  return (
    <>
      <PageHeader
        eyebrow="Actors"
        title={actor.name}
        subtitle={actor.source === "likeness" ? "From an uploaded face" : "Generated face"}
      />
      <PageBody>
        <div className="space-y-8">
          <CharacterPack stillUrl={actor.still_url} refs={actor.refs} emptyLabel="Casting" />
          <div>
            <h2 className="text-lg font-semibold">Played in</h2>
            {actor.appearances.length ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {actor.appearances.map((row) => (
                  <a key={row.character_id} href={`/characters/${row.character_id}`} className="rounded-xl border border-secondary bg-primary p-5">
                    <div className="text-xs font-semibold text-tertiary">{row.series_title}</div>
                    <div className="mt-1 text-lg font-semibold">{row.role}</div>
                    <div className="mt-2">
                      <Badge type="pill-color" color={row.locked ? "success" : "gray"} size="sm">
                        {row.locked ? "Ready" : "Casting"}
                      </Badge>
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-tertiary">Not attached to a show yet.</p>
            )}
          </div>
        </div>
      </PageBody>
    </>
  );
}
