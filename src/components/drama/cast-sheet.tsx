import { useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { NewActorForm } from "@/components/drama/actor-form.tsx";
import { CastCardSkeleton } from "@/components/drama/cast-card.tsx";
import { Poster } from "@/components/drama/poster.tsx";
import { LoadError } from "@/components/drama/skeleton.tsx";
import { studio, type Actor, type CastSlot } from "@/lib/api.ts";
import { packPercent, queueLabel, queuePlaces } from "@/lib/cast-queue.ts";
import { useStudio } from "@/lib/use-studio.ts";
import { cx } from "@/utils/cx";

function slotIsNamed(slot: CastSlot) {
  return Boolean(slot.role_name || slot.suggested_name || slot.named);
}

/** Whether a face or a name is being made for this slot right now. */
function slotIsWorking(slot: CastSlot): boolean {
  if (slot.actor_status === "running" || slot.actor_status === "queued") return true;
  // Naming runs before any face can be generated, and it is work too.
  return !slotIsNamed(slot);
}

/** How far along the face pack is, as a percentage, or null before the first step lands. */
function slotProgress(slot: CastSlot): number | undefined {
  return packPercent(slot.actor_progress?.done, slot.actor_progress?.total);
}

/**
 * Faces are built one part at a time for a show, so most waiting cards have not
 * started yet. Saying "Building" on all of them made a normal queue look like a
 * stall, so a part that is only waiting says so, and says how many are ahead.
 */
function actorChip(slot: CastSlot, place?: number): string | undefined {
  if (slot.actor_status === "running") {
    const done = slot.actor_progress?.done ?? 0;
    const total = slot.actor_progress?.total ?? 4;
    return done === 0 ? "Creating first portrait…" : `Building · ${done}/${total}`;
  }
  if (slot.actor_status === "queued") return queueLabel(place);
  if (slot.actor_status === "failed") return "Needs attention";
  if (!slot.character_still_url && !slot.actor_still_url) {
    if (!slotIsNamed(slot)) return "Naming…";
    return slot.actor_id ? "Casting" : "No face yet";
  }
  return undefined;
}


/**
 * The cast sheet for one show. Slate placeholders (Lead / Antagonist /
 * Confidant / Disruptor) come from the brief. Each castable part is either
 * generated for you or played by someone from the catalog.
 */
export function CastSheet({ seriesId }: { seriesId: string }) {
  const { data, error, reload } = useStudio(`cast:${seriesId}`, () => studio.seriesCast(seriesId), [seriesId]);
  const [open, setOpen] = useState<string | null>(null);
  const [addRole, setAddRole] = useState("");
  const [adding, setAdding] = useState(false);
  const [showBackground, setShowBackground] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (error && !data) return <LoadError message={error} onRetry={() => void reload()} />;
  if (!data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <CastCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  const cast = async (slot: Partial<CastSlot> & { display_name?: string }, actorId: string | null) => {
    setBusy(true);
    setSaveError(null);
    try {
      await studio.castRole(seriesId, {
        slot_id: slot.id,
        role_name: slot.role_name ?? slot.display_name ?? undefined,
        actor_id: actorId,
        character_id: slot.character_id ?? undefined,
      });
      setOpen(null);
      setAddRole("");
      setAdding(false);
      await reload();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Could not save the cast.");
    } finally {
      setBusy(false);
    }
  };

  const generateAi = async (slotIds?: string[]) => {
    setBusy(true);
    setSaveError(null);
    try {
      const result = await studio.generateCast(seriesId, slotIds?.length ? { slot_ids: slotIds } : {});
      if (result.generated === 0) {
        setSaveError(
          result.naming
            ? "The parts are still being named. Wait a moment, then generate faces."
            : "Every part already has a face, or is a story element.",
        );
      }
      setOpen(null);
      await reload();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Could not generate those faces.");
    } finally {
      setBusy(false);
    }
  };

  const drop = async (slot: CastSlot) => {
    setBusy(true);
    setSaveError(null);
    try {
      await studio.uncastRole(seriesId, slot.id);
      setOpen(null);
      await reload();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Could not remove this part.");
    } finally {
      setBusy(false);
    }
  };

  // The cast sheet contains people only. Older API responses can still include
  // internal story-device rows, so keep this boundary on both client and server.
  const people = data.items.filter((slot) => slot.castable);
  // One queue for the whole show, so it is counted across sections, not inside them.
  const places = queuePlaces(people);
  const leads = people.filter((slot) => slot.importance === "lead");
  const supporting = people.filter((slot) => slot.importance === "supporting");
  const background = people.filter((slot) => slot.importance === "background");
  const nameTaken = data.items.some(
    (slot) => String(slot.role_name ?? slot.display_name).trim().toLowerCase() === addRole.trim().toLowerCase(),
  );
  const missing = data.items.filter((slot) => slot.castable && slotIsNamed(slot) && !slot.locked && !slot.actor_id);
  const naming = data.items.some((slot) => slot.castable && !slotIsNamed(slot));

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-2xl text-sm text-secondary">
          {naming
            ? "We’re naming each speaking part and locking their gender before any face is generated."
            : data.story_written
              ? "Every part in this show. Use your own face, pick from the catalog, or generate a face with AI."
              : "These parts come from the brief. Each speaking part has a name and gender before we generate a face."}
        </p>
        {missing.length ? (
          <Button color="secondary" size="sm" isDisabled={busy} onClick={() => void generateAi()}>
            {busy ? "Generating…" : "Generate missing characters with AI"}
          </Button>
        ) : null}
      </div>

      {saveError ? <p className="text-sm text-error-primary">{saveError}</p> : null}

      <SlotSection
        title="Leads"
        empty="No leads on this slate yet."
        slots={leads}
        places={places}
        seriesId={seriesId}
        roster={data.roster}
        busy={busy}
        open={open}
        onOpen={setOpen}
        onCast={cast}
        onGenerate={(slot) => void generateAi([slot.id])}
        onRemove={drop}
      />

      <SlotSection
        title="Supporting"
        empty="No supporting parts yet."
        slots={supporting}
        places={places}
        seriesId={seriesId}
        roster={data.roster}
        busy={busy}
        open={open}
        onOpen={setOpen}
        onCast={cast}
        onGenerate={(slot) => void generateAi([slot.id])}
        onRemove={drop}
      />

      {background.length ? (
        <section>
          {showBackground ? (
            <SlotSection
              title="Background"
              empty=""
              slots={background}
              places={places}
              seriesId={seriesId}
              roster={data.roster}
              busy={busy}
              open={open}
              onOpen={setOpen}
              onCast={cast}
              onGenerate={(slot) => void generateAi([slot.id])}
              onRemove={drop}
            />
          ) : (
            <Button color="tertiary" size="sm" onClick={() => setShowBackground(true)}>
              Cast a background part too
            </Button>
          )}
        </section>
      ) : null}

      {data.unclaimed.length ? (
        <section>
          <h3 className="text-sm font-semibold text-tertiary">Parts the story wrote</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.unclaimed.map((role) => (
              <div key={role.id} className="overflow-hidden rounded-xl border border-secondary bg-primary">
                <Poster src={role.still_url} title={role.still_url ? undefined : role.name} chip="Written for you" ratio="34" />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-lg font-semibold">{role.name}</div>
                    <Badge type="pill-color" color={role.locked ? "success" : "gray"} size="sm">
                      {role.locked ? "Ready" : "Casting"}
                    </Badge>
                  </div>
                  {role.description ? <p className="mt-2 line-clamp-3 text-sm text-tertiary">{role.description}</p> : null}
                  {role.locked ? (
                    <p className="mt-3 text-sm text-tertiary">This part already shot. Its face stays the same for the rest of the show.</p>
                  ) : (
                    <div className="mt-3">
                      {open === role.id ? (
                        <ActorPicker
                          seriesId={seriesId}
                          roster={data.roster}
                          selected={null}
                          busy={busy}
                          onPick={(actorId) => void cast({ role_name: role.name, character_id: role.id, display_name: role.name }, actorId)}
                          onCreated={(actor) => void cast({ role_name: role.name, character_id: role.id, display_name: role.name }, actor.id)}
                        />
                      ) : (
                        <Button color="secondary" size="sm" onClick={() => setOpen(role.id)}>
                          Use my own
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {adding ? (
        <section className="rounded-xl border border-secondary bg-primary p-5">
          <h3 className="text-md font-semibold">Add another part</h3>
          <p className="mt-1 max-w-xl text-sm text-tertiary">A part you add here is extra to the slate.</p>
          <div className="mt-4 flex max-w-md flex-col gap-3">
            <Input
              label="Part"
              value={addRole}
              onChange={setAddRole}
              placeholder="Yacine"
              isInvalid={Boolean(addRole.trim()) && nameTaken}
              hint={addRole.trim() && nameTaken ? "That part is already on the sheet." : undefined}
            />
            {open === "new" ? (
              <ActorPicker
                seriesId={seriesId}
                roster={data.roster}
                selected={null}
                busy={busy}
                onPick={(actorId) => void cast({ role_name: addRole, display_name: addRole }, actorId)}
                onCreated={(actor) => void cast({ role_name: addRole, display_name: addRole }, actor.id)}
              />
            ) : (
              <div className="flex gap-2">
                <Button
                  color="secondary"
                  size="sm"
                  isDisabled={!addRole.trim() || nameTaken || busy}
                  onClick={() => setOpen("new")}
                >
                  Choose who plays it
                </Button>
                <Button color="tertiary" size="sm" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </section>
      ) : (
        <Button color="tertiary" size="sm" onClick={() => setAdding(true)}>
          Add another part
        </Button>
      )}
    </div>
  );
}

function SlotSection({
  title,
  empty,
  slots,
  places,
  seriesId,
  roster,
  busy,
  open,
  onOpen,
  onCast,
  onGenerate,
  onRemove,
}: {
  title: string;
  empty: string;
  slots: CastSlot[];
  places: Map<string, number>;
  seriesId: string;
  roster: Actor[];
  busy: boolean;
  open: string | null;
  onOpen: (id: string | null) => void;
  onCast: (slot: CastSlot, actorId: string | null) => void;
  onGenerate: (slot: CastSlot) => void;
  onRemove: (slot: CastSlot) => void;
}) {
  if (!slots.length) {
    return empty ? (
      <section>
        <h3 className="text-sm font-semibold text-tertiary">{title}</h3>
        <p className="mt-2 text-sm text-tertiary">{empty}</p>
      </section>
    ) : null;
  }
  return (
    <section>
      <h3 className="text-sm font-semibold text-tertiary">{title}</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {slots.map((slot) => (
          <SlotCard
            key={slot.id}
            slot={slot}
            place={places.get(slot.id)}
            busy={busy}
            isOpen={open === slot.id}
            onOpen={() => onOpen(open === slot.id ? null : slot.id)}
            onRemove={() => onRemove(slot)}
            onGenerate={() => onGenerate(slot)}
          >
            <ActorPicker
              seriesId={seriesId}
              roster={roster}
              selected={slot.actor_id}
              busy={busy}
              onPick={(actorId) => onCast(slot, actorId)}
              onCreated={(actor) => onCast(slot, actor.id)}
            />
          </SlotCard>
        ))}
      </div>
    </section>
  );
}

function SlotCard({
  slot,
  place,
  busy,
  isOpen,
  onOpen,
  onRemove,
  onGenerate,
  children,
}: {
  slot: CastSlot;
  place?: number;
  busy: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onGenerate: () => void;
  children: React.ReactNode;
}) {
  const still = slot.character_still_url ?? slot.actor_still_url;
  const working = !still && slotIsWorking(slot);
  return (
    <div className="overflow-hidden rounded-xl border border-secondary bg-primary">
      <Poster
        src={still}
        title={still ? undefined : slot.display_name}
        chip={actorChip(slot, place)}
        ratio="34"
        working={working}
        progress={working ? slotProgress(slot) : undefined}
      />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            {slot.job_label ? (
              <div className="text-xs font-semibold text-tertiary">
                {slot.job_label}
                {slot.suggested_gender ? ` · ${slot.suggested_gender === "woman" ? "Woman" : "Man"}` : ""}
              </div>
            ) : null}
            <div className="text-lg font-semibold">{slot.display_name}</div>
          </div>
          {slot.locked ? (
            <Badge type="pill-color" color="success" size="sm">
              Ready
            </Badge>
          ) : null}
        </div>
        {slot.archetype && slot.archetype !== slot.display_name ? (
          <p className="mt-1 text-xs text-tertiary">{slot.archetype}</p>
        ) : null}
        <p className="mt-1 text-sm text-tertiary">
          {slot.actor_name ? (
            <>
              Played by{" "}
              <a href={`/actors/${slot.actor_id}`} className="font-semibold text-primary">
                {slot.actor_name}
              </a>
              {slot.actor_source === "likeness" ? " · from your photo" : ""}
            </>
          ) : slotIsNamed(slot) ? (
            "No face yet"
          ) : (
            "Naming this part…"
          )}
        </p>
        {slot.character_id ? (
          <a href={`/characters/${slot.character_id}`} className="mt-2 inline-block text-sm font-semibold text-brand-secondary">
            Open the role
          </a>
        ) : null}
        {slot.locked ? (
          <p className="mt-3 text-sm text-tertiary">This part already shot. Its face stays the same.</p>
        ) : (
          <div className="mt-3">
            {isOpen ? (
              children
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button color="secondary" size="sm" onClick={onOpen} isDisabled={busy}>
                  Use my own
                </Button>
                {slot.actor_id ? null : (
                  <Button color="secondary" size="sm" onClick={onGenerate} isDisabled={busy || !slotIsNamed(slot)}>
                    Generate with AI
                  </Button>
                )}
                {slot.origin === "buyer" ? (
                  <Button color="tertiary" size="sm" onClick={onRemove} isDisabled={busy}>
                    Remove
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ActorPicker({
  seriesId,
  roster,
  selected,
  busy,
  onPick,
  onCreated,
}: {
  seriesId: string;
  roster: Actor[];
  selected: string | null;
  busy: boolean;
  onPick: (actorId: string | null) => void;
  onCreated: (actor: Actor) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState("");

  if (adding) {
    return (
      <div className="rounded-lg bg-secondary p-4">
        <NewActorForm
          compact
          seriesId={seriesId}
          onDone={(actor) => {
            setAdding(false);
            onCreated(actor);
          }}
          onCancel={() => setAdding(false)}
        />
      </div>
    );
  }

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? roster.filter(
        (actor) =>
          actor.name.toLowerCase().includes(needle) ||
          actor.tags.some((tag) => tag.toLowerCase().includes(needle)) ||
          actor.shows.some((show) => show.toLowerCase().includes(needle)),
      )
    : roster;

  return (
    <div className="space-y-3">
      {roster.length > 6 ? (
        <Input aria-label="Find an actor" value={filter} onChange={setFilter} placeholder="Find by name, tag, or show" />
      ) : null}
      {shown.length ? (
        <ul className="grid grid-cols-3 gap-2">
          {shown.map((actor) => (
            <li key={actor.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(actor.id)}
                className={cx(
                  "block w-full cursor-pointer overflow-hidden rounded-lg text-left ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-60",
                  actor.id === selected ? "ring-2 ring-brand" : "ring-secondary hover:ring-brand",
                )}
              >
                <Poster src={actor.still_url} title={actor.still_url ? undefined : actor.name} ratio="34" />
                <span className="block truncate px-2 py-1.5 text-xs font-semibold text-primary">{actor.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-tertiary">
          {roster.length ? "No face matches that." : "Your catalog is empty. Add someone to start it."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button color="secondary" size="sm" onClick={() => setAdding(true)} isDisabled={busy}>
          Add someone new
        </Button>
      </div>
    </div>
  );
}
