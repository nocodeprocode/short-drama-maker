import { useRef, useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { CastCardSkeleton } from "@/components/drama/cast-card.tsx";
import { LoadError } from "@/components/drama/skeleton.tsx";
import { studio, type ObjectEntry } from "@/lib/api.ts";
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

function statusChip(entry: ObjectEntry): string | undefined {
  if (entry.status === "building") return "Building…";
  if (entry.status === "failed") return "Needs attention";
  if (entry.status === "planned" && !entry.image_url) return "No picture yet";
  return undefined;
}

/**
 * An object is a thing, never a person, so this deliberately does not use the
 * cast poster with its human silhouette placeholder.
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
  const { data, error, reload } = useStudio("objects", () => studio.objects());
  /** A tag, or "" for every object. */
  const [tag, setTag] = useState("");

  if (error && !data) return <LoadError message={error} onRetry={() => void reload()} />;

  const shown = data ? (tag ? data.items.filter((entry) => entry.tags.includes(tag)) : data.items) : [];

  return (
    <>
      <PageHeader
        title="Objects"
        subtitle="Your catalog of props. An object is shot alone, so the same contract or letter stays the same object every time it appears. Use it on any show."
      />
      <PageBody>
        {data && data.tags.length ? (
          <div className="mb-5 flex flex-wrap items-center gap-1.5">
            <TagChip label="All objects" isOn={!tag} onClick={() => setTag("")} />
            {data.tags.map((item) => (
              <TagChip key={item} label={item} isOn={tag === item} onClick={() => setTag(tag === item ? "" : item)} />
            ))}
          </div>
        ) : null}

        {!data ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <CastCardSkeleton key={index} />
            ))}
          </div>
        ) : null}

        {shown.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map((entry) => (
              <ObjectCard key={entry.id} entry={entry} onChanged={() => void reload()} />
            ))}
          </div>
        ) : null}

        {data && data.items.length === 0 ? (
          <div className="ds-empty">
            <p className="text-sm font-semibold">No objects yet</p>
            <p className="mt-1 text-sm text-tertiary">
              Name a prop below and it is shot for you, or bring your own picture of one. Every object you keep here can
              be used on any show.
            </p>
          </div>
        ) : null}
        {data && data.items.length > 0 && shown.length === 0 ? (
          <p className="text-sm text-tertiary">No object is tagged “{tag}”.</p>
        ) : null}

        {data ? <AddObject onAdded={() => void reload()} /> : null}
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

function ObjectCard({ entry, onChanged }: { entry: ObjectEntry; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entry.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const building = entry.status === "building";
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
      await studio.updateObject(entry.id, { name: next });
      setEditing(false);
    }, "Could not save the name.");
  }

  function remove() {
    // An object already on screen stays in those shows: the shoot keeps its own
    // copy, so the buyer has to be told what removing it here does and does not do.
    if (entry.shows.length) {
      const ok = window.confirm(
        `${entry.name} is used in ${entry.shows.join(", ")}. Those shows keep their own copy of it. Remove it from your catalog?`,
      );
      if (!ok) return;
    }
    void run(() => studio.deleteObject(entry.id), "Could not remove this object.");
  }

  return (
    <div className="overflow-hidden rounded-xl border border-secondary bg-primary">
      <Plate src={entry.image_url} chip={statusChip(entry)} working={building} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-md font-semibold">{entry.name}</div>
          </div>
          <Badge type="pill-color" color={entry.source === "upload" ? "brand" : "gray"} size="sm">
            {entry.source === "upload" ? "Your photo" : "Generated"}
          </Badge>
        </div>

        {entry.notes ? <p className="mt-1 text-sm text-tertiary">{entry.notes}</p> : null}
        {entry.state ? <p className="mt-1 text-xs text-tertiary">{entry.state} state</p> : null}
        {entry.kind ? <p className="mt-1 text-xs text-tertiary">{entry.kind}</p> : null}
        {entry.shows.length ? <p className="mt-1 text-sm text-tertiary">Used in {entry.shows.join(", ")}</p> : null}
        {entry.error ? <p className="mt-2 text-xs text-error-primary">{entry.error}</p> : null}

        {entry.tags.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {entry.tags.map((item) => (
              <span key={item} className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary">
                {item}
              </span>
            ))}
          </div>
        ) : null}

        {editing ? (
          <div className="mt-3 space-y-2">
            <Input aria-label={`Name for ${entry.name}`} value={name} onChange={setName} placeholder="Sealed letter" />
            <div className="flex gap-2">
              <Button color="primary" size="sm" isDisabled={busy || !name.trim()} onClick={() => void save()}>
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button
                color="tertiary"
                size="sm"
                isDisabled={busy}
                onClick={() => {
                  setName(entry.name);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              color="secondary"
              size="sm"
              isDisabled={blocked}
              onClick={() => void run(() => studio.buildObject(entry.id), "Could not build this object.")}
            >
              {building ? "Building…" : entry.image_url ? "Build it again" : "Build it"}
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
                  await studio.uploadObjectImage(entry.id, {
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

function AddObject({ onAdded }: { onAdded: () => void }) {
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
      setError(caught instanceof Error ? caught.message : "Could not add this object.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 rounded-xl border border-secondary bg-primary p-4">
      <p className="text-sm font-semibold">Add an object</p>
      <p className="mt-1 text-sm text-tertiary">
        Name it and it is shot alone for you, or bring your own picture of the thing. A name is needed either way.
      </p>
      {error ? <p className="mt-2 text-sm text-error-primary">{error}</p> : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="sm:max-w-xs sm:grow">
          <Input aria-label="Object name" placeholder="Sealed letter" value={name} onChange={setName} />
        </div>
        <Button
          color="primary"
          size="sm"
          isDisabled={busy || !named}
          onClick={() => void run((value) => studio.createObject({ name: value }))}
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
              await studio.createObject({
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
