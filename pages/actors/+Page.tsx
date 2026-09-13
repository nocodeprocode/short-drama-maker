import { useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { NewActorForm } from "@/components/drama/actor-form.tsx";
import { CastCardSkeleton } from "@/components/drama/cast-card.tsx";
import { Poster } from "@/components/drama/poster.tsx";
import { LoadError } from "@/components/drama/skeleton.tsx";
import { studio, type Actor } from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";
import { cx } from "@/utils/cx";

export default function Page() {
  const { data, error, reload } = useStudio("actors", () => studio.actors());
  const [open, setOpen] = useState(false);
  /** A tag, or "" for everyone. */
  const [tag, setTag] = useState("");

  if (error && !data) return <LoadError message={error} onRetry={() => void reload()} />;

  const shown = data ? (tag ? data.items.filter((actor) => actor.tags.includes(tag)) : data.items) : [];

  return (
    <>
      <PageHeader
        title="Actors"
        subtitle="Your catalog of faces. Cast the same person across shows, sequels, and spin-offs."
        actions={
          <Button color="primary" size="sm" onClick={() => setOpen(true)}>
            New actor
          </Button>
        }
      />
      <PageBody>
        {open ? (
          <NewActorForm
            onDone={() => {
              setOpen(false);
              void reload();
            }}
            onCancel={() => setOpen(false)}
          />
        ) : null}

        {data && data.tags.length ? (
          <div className="mb-5 flex flex-wrap items-center gap-1.5">
            <TagChip label="Everyone" isOn={!tag} onClick={() => setTag("")} />
            {data.tags.map((item) => (
              <TagChip key={item} label={item} isOn={tag === item} onClick={() => setTag(tag === item ? "" : item)} />
            ))}
          </div>
        ) : null}

        {!data ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <CastCardSkeleton key={index} />
            ))}
          </div>
        ) : null}

        {shown.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((actor) => (
              <ActorCard key={actor.id} actor={actor} onChanged={() => void reload()} />
            ))}
          </div>
        ) : null}

        {data && data.items.length === 0 ? (
          <p className="text-sm text-tertiary">
            No faces yet. Add one from a photo of you or an actor you have the rights to, and it is reusable on every
            show. Any part you leave uncast is written and cast for you, and that face lands here too.
          </p>
        ) : null}
        {data && data.items.length > 0 && shown.length === 0 ? (
          <p className="text-sm text-tertiary">Nobody is tagged “{tag}”.</p>
        ) : null}
      </PageBody>
    </>
  );
}

function TagChip({ label, isOn, onClick }: { label: string; isOn: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={isOn}
      onClick={onClick}
      className={cx(
        "cursor-pointer rounded-full px-3 py-1 text-xs font-semibold ring-1 transition duration-100 ease-linear ring-inset outline-focus-ring",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
        isOn ? "bg-brand-solid text-white ring-transparent" : "text-tertiary ring-secondary hover:text-secondary",
      )}
    >
      {label}
    </button>
  );
}

function ActorCard({ actor, onChanged }: { actor: Actor; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [tags, setTags] = useState(actor.tags.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const building = actor.status === "running" || actor.status === "queued";
  // Undefined until a still lands: a bar parked at zero reads as stuck.
  const done = actor.progress?.done ?? 0;
  const total = actor.progress?.total ?? 0;
  const packProgress = total && done > 0 ? Math.round((Math.min(done, total) / total) * 100) : undefined;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await studio.updateActor(actor.id, {
        tags: tags
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setEditing(false);
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the tags.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await studio.deleteActor(actor.id);
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove this actor.");
      setBusy(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-secondary bg-primary">
      <a href={`/actors/${actor.id}`} className="block">
        <Poster
          src={actor.still_url}
          title={actor.still_url ? undefined : actor.name}
          chip={
            building
              ? `Building · ${actor.progress?.done ?? 0}/${actor.progress?.total ?? 4}`
              : actor.status === "failed"
                ? "Needs attention"
                : actor.still_url
                  ? undefined
                  : "Casting"
          }
          ratio="34"
          working={building && !actor.still_url}
          progress={building && !actor.still_url ? packProgress : undefined}
        />
      </a>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <a href={`/actors/${actor.id}`} className="text-lg font-semibold">
            {actor.name}
          </a>
          <Badge type="pill-color" color={actor.source === "likeness" ? "brand" : "gray"} size="sm">
            {actor.source === "likeness" ? "Your photo" : "Written"}
          </Badge>
        </div>

        <p className="mt-1 text-sm text-tertiary">
          {actor.shows.length
            ? `Played in ${actor.shows.slice(0, 2).join(", ")}${actor.shows.length > 2 ? ` +${actor.shows.length - 2}` : ""}`
            : actor.ready
              ? "Not cast yet. Ready for a role."
              : "Building the face pack…"}
        </p>

        {editing ? (
          <div className="mt-3 space-y-2">
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="lead, franchise, season 2"
              aria-label={`Tags for ${actor.name}`}
              className="w-full rounded-lg bg-primary px-3 py-2 text-sm text-primary ring-1 ring-secondary outline-focus-ring ring-inset placeholder:text-placeholder focus:outline-2 focus:outline-offset-2"
            />
            {error ? <p className="text-sm text-error-primary">{error}</p> : null}
            <div className="flex gap-2">
              <Button color="primary" size="sm" isDisabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Save tags"}
              </Button>
              <Button
                color="tertiary"
                size="sm"
                onClick={() => {
                  setTags(actor.tags.join(", "));
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {actor.tags.map((item) => (
              <span key={item} className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary">
                {item}
              </span>
            ))}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="cursor-pointer rounded-full px-2 py-1 text-xs font-semibold text-brand-secondary outline-focus-ring hover:underline focus-visible:outline-2"
            >
              {actor.tags.length ? "Edit tags" : "Add tags"}
            </button>
            {/* A face that already shot cannot go: the server refuses it. */}
            {actor.shows.length ? null : (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="cursor-pointer rounded-full px-2 py-1 text-xs font-semibold text-tertiary outline-focus-ring hover:underline focus-visible:outline-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Removing…" : "Remove"}
              </button>
            )}
          </div>
        )}
        {!editing && error ? <p className="mt-2 text-sm text-error-primary">{error}</p> : null}
      </div>
    </div>
  );
}
