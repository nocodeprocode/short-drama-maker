import { useRef, useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { CastCardSkeleton } from "@/components/drama/cast-card.tsx";
import { LoadError } from "@/components/drama/skeleton.tsx";
import { studio, type PlaceEntry } from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";
import { cx } from "@/utils/cx";

const IMAGE_TYPES = "image/png,image/jpeg,image/webp";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function statusChip(place: PlaceEntry): string | undefined {
  if (place.status === "building") return "Building…";
  if (place.status === "failed") return "Needs attention";
  if (place.status === "planned" && !place.image_url) return "No picture yet";
  return undefined;
}

/**
 * A place is a room, never a person, so this deliberately does not use the cast
 * poster with its human silhouette placeholder.
 */
function Plate({ src, chip, working }: { src?: string | null; chip?: string; working?: boolean }) {
  return (
    <div className={cx("poster g1 ratio-34", working && "is-working")}>
      {src ? <img src={src} alt="" className="poster-photo" /> : null}
      {chip ? <span className={cx("pchip", working && "is-working")}>{chip}</span> : null}
      {working ? (
        <span className="pbar is-indeterminate">
          <i />
        </span>
      ) : null}
    </div>
  );
}

export default function Page() {
  const { data, error, reload } = useStudio("places", () => studio.places());
  /** A tag, or "" for every place. */
  const [tag, setTag] = useState("");

  if (error && !data) return <LoadError message={error} onRetry={() => void reload()} />;

  const shown = data ? (tag ? data.items.filter((place) => place.tags.includes(tag)) : data.items) : [];

  return (
    <>
      <PageHeader
        title="Places"
        subtitle="Your catalog of sets. A place is built once as an empty plate and reused, so every scene there is the same room. Use the same place on any show."
      />
      <PageBody>
        {data && data.tags.length ? (
          <div className="mb-5 flex flex-wrap items-center gap-1.5">
            <TagChip label="All places" isOn={!tag} onClick={() => setTag("")} />
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
            {shown.map((place) => (
              <PlaceCard key={place.id} place={place} onChanged={() => void reload()} />
            ))}
          </div>
        ) : null}

        {data && data.items.length === 0 ? (
          <div className="ds-empty">
            <p className="text-sm font-semibold">No places yet</p>
            <p className="mt-1 text-sm text-tertiary">
              Name a room below and it is built for you, or bring your own picture of one. Every place you keep here can
              be used on any show.
            </p>
          </div>
        ) : null}
        {data && data.items.length > 0 && shown.length === 0 ? (
          <p className="text-sm text-tertiary">No place is tagged “{tag}”.</p>
        ) : null}

        {data ? <AddPlace onAdded={() => void reload()} /> : null}
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

function PlaceCard({ place, onChanged }: { place: PlaceEntry; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(place.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const building = place.status === "building";
  const blocked = busy || building;

  async function run(work: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const next = name.trim();
    if (!next) return;
    await run(async () => {
      await studio.updatePlace(place.id, { name: next });
      setEditing(false);
    }, "Could not save the name.");
  }

  function remove() {
    // A place already in footage stays in those shows: the shoot keeps its own
    // copy, so the buyer has to be told what removing it here does and does not do.
    if (place.shows.length) {
      const ok = window.confirm(
        `${place.name} is used in ${place.shows.join(", ")}. Those shows keep their own copy of the room. Remove it from your catalog?`,
      );
      if (!ok) return;
    }
    void run(() => studio.deletePlace(place.id), "Could not remove this place.");
  }

  return (
    <div className="overflow-hidden rounded-xl border border-secondary bg-primary">
      <Plate src={place.image_url} chip={statusChip(place)} working={building} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-lg font-semibold">{place.name}</div>
          </div>
          <Badge type="pill-color" color={place.source === "upload" ? "brand" : "gray"} size="sm">
            {place.source === "upload" ? "Your photo" : "Generated"}
          </Badge>
        </div>

        {place.notes ? <p className="mt-1 text-sm text-tertiary">{place.notes}</p> : null}
        {place.lighting_lock ? <p className="mt-1 text-xs text-tertiary">{place.lighting_lock}</p> : null}
        {place.shows.length ? (
          <p className="mt-1 text-sm text-tertiary">Used in {place.shows.join(", ")}</p>
        ) : null}
        {place.error ? <p className="mt-2 text-xs text-error-primary">{place.error}</p> : null}

        {place.tags.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {place.tags.map((item) => (
              <span key={item} className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary">
                {item}
              </span>
            ))}
          </div>
        ) : null}

        {editing ? (
          <div className="mt-3 space-y-2">
            <Input aria-label={`Name for ${place.name}`} value={name} onChange={setName} placeholder="Penthouse kitchen" />
            <div className="flex gap-2">
              <Button color="primary" size="sm" isDisabled={busy || !name.trim()} onClick={() => void save()}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button
                color="tertiary"
                size="sm"
                isDisabled={busy}
                onClick={() => {
                  setName(place.name);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button color="secondary" size="sm" isDisabled={blocked} onClick={() => void run(() => studio.buildPlace(place.id), "Could not build this place.")}>
              {building ? "Building…" : place.image_url ? "Build it again" : "Build it"}
            </Button>
            <Button color="tertiary" size="sm" isDisabled={blocked} onClick={() => pickerRef.current?.click()}>
              Use my own
            </Button>
            <Button color="tertiary" size="sm" isDisabled={blocked} onClick={() => setEditing(true)}>
              Rename
            </Button>
            <Button color="tertiary" size="sm" isDisabled={blocked} onClick={remove}>
              {busy ? "Working…" : "Remove"}
            </Button>
            <input
              ref={pickerRef}
              type="file"
              accept={IMAGE_TYPES}
              className="sr-only"
              tabIndex={-1}
              disabled={blocked}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void run(async () => {
                  await studio.uploadPlaceImage(place.id, {
                    image_base64: await fileToBase64(file),
                    image_mime_type: file.type,
                  });
                }, "Could not use that picture.");
              }}
            />
          </div>
        )}

        {error ? <p className="mt-2 text-sm text-error-primary">{error}</p> : null}
      </div>
    </div>
  );
}

function AddPlace({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const named = name.trim().length > 0;

  async function run(work: (trimmed: string) => Promise<unknown>) {
    const next = name.trim();
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      await work(next);
      setName("");
      onAdded();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add this place.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 rounded-xl border border-secondary bg-primary p-4">
      <p className="text-sm font-semibold">Add a place</p>
      <p className="mt-1 text-sm text-tertiary">
        Name it and the empty plate is built for you, or bring your own picture of the room. A name is needed either way.
      </p>
      {error ? <p className="mt-2 text-sm text-error-primary">{error}</p> : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="sm:max-w-xs sm:grow">
          <Input aria-label="Place name" placeholder="Penthouse kitchen" value={name} onChange={setName} />
        </div>
        <Button
          color="primary"
          size="sm"
          isDisabled={busy || !named}
          onClick={() => void run((value) => studio.createPlace({ name: value }))}
        >
          {busy ? "Adding…" : "Add"}
        </Button>
        <Button color="secondary" size="sm" isDisabled={busy || !named} onClick={() => pickerRef.current?.click()}>
          Add from my picture
        </Button>
        <input
          ref={pickerRef}
          type="file"
          accept={IMAGE_TYPES}
          className="sr-only"
          tabIndex={-1}
          disabled={busy || !named}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void run(async (value) => {
              await studio.createPlace({
                name: value,
                image_base64: await fileToBase64(file),
                image_mime_type: file.type,
              });
            });
          }}
        />
      </div>
    </div>
  );
}
