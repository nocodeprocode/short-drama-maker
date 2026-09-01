import { useState } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { CharacterPack } from "@/components/drama/cast-card.tsx";
import { AccountSkeleton, LoadError } from "@/components/drama/skeleton.tsx";
import { studio, type Actor } from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";

export default function Page() {
  const id = usePageContext().routeParams.id;
  const { data: character, error, reload } = useStudio(`character:${id}`, () => studio.character(id), [id]);
  const unlocked = Boolean(character && !character.locked);
  const { data: actors } = useStudio("actors", () => studio.actors());
  const [actorId, setActorId] = useState("");
  const [casting, setCasting] = useState(false);
  const [castError, setCastError] = useState<string | null>(null);

  if (error && !character) return <LoadError message={error} onRetry={() => void reload()} />;
  if (!character) return <AccountSkeleton />;

  const pack = character.refs ?? [];
  const looks = character.wardrobe ?? [];

  async function attach() {
    if (!actorId) return;
    setCasting(true);
    setCastError(null);
    try {
      await studio.castCharacter(id, actorId);
      await reload();
    } catch (caught) {
      setCastError(caught instanceof Error ? caught.message : "Could not attach this actor.");
    } finally {
      setCasting(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={`${character.series_title} · Cast`}
        title={character.name}
        subtitle={character.description}
        actions={
          <Badge type="pill-color" color={character.locked ? "success" : "gray"} size="sm">
            {character.locked ? "Ready" : "Casting"}
          </Badge>
        }
      />
      <PageBody>
        <div className="space-y-6">
          <CharacterPack stillUrl={character.still_url} refs={pack} emptyLabel="Casting" />
          {character.actor_name ? (
            <p className="text-sm text-secondary">
              Played by{" "}
              {character.actor_id ? (
                <a href={`/actors/${character.actor_id}`} className="font-semibold text-primary">
                  {character.actor_name}
                </a>
              ) : (
                character.actor_name
              )}
              {character.locked ? ". Face and voice stay locked for the rest of this show." : "."}
            </p>
          ) : (
            <p className="text-sm text-secondary">
              {character.locked
                ? "Face and voice are locked for the rest of this show."
                : "This role is still being cast."}
            </p>
          )}
          {looks.length ? (
            <div>
              <h2 className="text-sm font-semibold text-tertiary">Show looks</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {looks.map((look) => (
                  <figure key={look.look}>
                    <img src={look.url} alt={look.label} className="aspect-[3/4] w-full rounded-lg object-cover" />
                    <figcaption className="mt-1.5 text-xs font-medium text-tertiary">{look.label}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ) : null}
          {character.voice_description ? <p className="text-sm text-tertiary">{character.voice_description}</p> : null}
          {unlocked ? (
            <div className="max-w-xl rounded-xl border border-secondary bg-primary p-5">
              <h2 className="text-sm font-semibold">Attach an actor</h2>
              <p className="mt-1 text-sm text-tertiary">Reuse a face from your roster. Looks are generated from this story.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <select
                  className="min-w-48 rounded-lg border border-secondary bg-primary px-3 py-2 text-sm"
                  value={actorId}
                  onChange={(event) => setActorId(event.target.value)}
                >
                  <option value="">Choose actor</option>
                  {(actors?.items ?? []).map((actor: Actor) => (
                    <option key={actor.id} value={actor.id}>
                      {actor.name}
                    </option>
                  ))}
                </select>
                <Button color="secondary" size="sm" onClick={() => void attach()} isDisabled={!actorId || casting}>
                  {casting ? "Attaching…" : "Attach"}
                </Button>
              </div>
              {castError ? <p className="mt-3 text-sm text-error-primary">{castError}</p> : null}
            </div>
          ) : null}
        </div>
      </PageBody>
    </>
  );
}
