import { useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { fileToBase64 } from "@/components/drama/actor-form.tsx";
import { CastCardSkeleton } from "@/components/drama/cast-card.tsx";
import { LoadError } from "@/components/drama/skeleton.tsx";
import {
  studio,
  type DesignLocation,
  type DesignProp,
  type DesignStatus,
  type ObjectEntry,
  type PlaceEntry,
} from "@/lib/api.ts";
import { useStudio } from "@/lib/use-studio.ts";
import { cx } from "@/utils/cx";

type Bucket = "locations" | "props";

/** One entry from the owner's catalog, narrowed to what a card needs to show. */
type Entry = { id: string; name: string; image_url: string | null; ready: boolean };

function asEntries(rows: Array<PlaceEntry | ObjectEntry>): Entry[] {
  return rows
    .filter((row) => row.ready && row.image_url)
    .map((row) => ({ id: row.id, name: row.name, image_url: row.image_url, ready: row.ready }));
}

/**
 * Pick something already built instead of paying to build it again. The same
 * room across two shows is the point of the catalog, so this is the cheapest and
 * most consistent of the three ways to fill a card.
 */
function LibraryStrip({
  entries,
  busy,
  onPick,
  onClose,
}: {
  entries: Entry[];
  busy: boolean;
  onPick: (entryId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-3 rounded-lg bg-secondary p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-secondary">From your library</span>
        <button type="button" onClick={onClose} className="cursor-pointer text-xs font-semibold text-tertiary hover:text-secondary">
          Close
        </button>
      </div>
      {entries.length ? (
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(entry.id)}
                className="block w-full cursor-pointer overflow-hidden rounded-md text-left ring-1 ring-secondary ring-inset transition hover:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="poster g1 ratio-34 block">
                  {entry.image_url ? <img src={entry.image_url} alt="" className="poster-photo" /> : null}
                </span>
                <span className="block truncate px-1.5 py-1 text-xs font-semibold">{entry.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-tertiary">
          Nothing built yet. Anything you build here is added to your library and can be reused on your next show.
        </p>
      )}
    </div>
  );
}

/** A hidden file input behind a button, so bringing your own picture is one click. */
function UploadButton({
  label,
  busy,
  onFile,
}: {
  label: string;
  busy: boolean;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button color="secondary" size="sm" isDisabled={busy} onClick={() => input.current?.click()}>
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </>
  );
}

function statusChip(status: DesignStatus, locked: boolean): string | undefined {
  if (locked) return undefined;
  if (status === "building") return "Building…";
  if (status === "failed") return "Needs attention";
  if (status === "planned") return "Not built yet";
  return undefined;
}

/**
 * A plate is a room or an object, never a person, so this deliberately does not
 * use the cast poster with its human silhouette placeholder.
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

/**
 * Production design for one show: the places we shoot in and the objects the
 * plot turns on. People live on the cast sheet — a location plate is judged
 * empty of figures before it is kept, and a prop is shot alone on a surface.
 */
export function DesignSheet({ seriesId }: { seriesId: string }) {
  const { data, error, reload } = useStudio(`design:${seriesId}`, () => studio.seriesDesign(seriesId), [seriesId]);
  const { data: library, reload: reloadLibrary } = useStudio("design-library", async () => {
    const [places, objects] = await Promise.all([studio.places(), studio.objects()]);
    return { places: places.items, objects: objects.items };
  });
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addPlace, setAddPlace] = useState("");
  const [addObject, setAddObject] = useState("");
  /** Which card has its library open. Only one at a time keeps the grid calm. */
  const [picking, setPicking] = useState<string | null>(null);
  // Rows the buyer just asked for. The request takes a few seconds and the card
  // has to change on the click, not when the server gets back to us.
  const [asked, setAsked] = useState<ReadonlySet<string>>(() => new Set());

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

  const missingLocations = data.locations.filter((row) => !row.plate_url && !row.locked && row.status !== "building");
  const missingProps = data.props.filter((row) => !row.still_url && !row.locked && row.status !== "building");
  const placeEntries = asEntries(library?.places ?? []);
  const objectEntries = asEntries(library?.objects ?? []);

  /** Work in flight: either the server says so, or we just asked for it. */
  const isWorking = (row: { id: string; status: DesignStatus }) => row.status === "building" || asked.has(row.id);

  const run = async (work: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setSaveError(null);
    try {
      await work();
      await reload();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Hold the asked-for rows only until the reload lands. After that the row's own
   * status drives the card, so a failed enqueue cannot leave a card spinning.
   */
  const askThenRun = async (ids: string[], work: () => Promise<unknown>, fallback: string) => {
    setAsked((current) => {
      const next = new Set(current);
      for (const id of ids) next.add(id);
      return next;
    });
    try {
      await run(work, fallback);
    } finally {
      setAsked((current) => {
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  };

  const build = (bucket: Bucket, id: string, force: boolean) =>
    askThenRun(
      [id],
      () => studio.buildDesign(seriesId, bucket, id, force ? { force: true } : {}),
      "Could not build that.",
    );

  const buildAll = (bucket: Bucket) =>
    askThenRun(
      (bucket === "props" ? missingProps : missingLocations).map((row) => row.id),
      async () => {
        const result = await studio.buildMissingDesign(seriesId, bucket);
        if (result.queued === 0) {
          setSaveError(bucket === "props" ? "Every object is already built." : "Every place is already built.");
        }
      },
      "Could not start those builds.",
    );

  const remove = (bucket: Bucket, id: string) =>
    run(() => studio.removeDesign(seriesId, bucket, id), "Could not remove that.");

  const useEntry = (bucket: Bucket, rowId: string, entryId: string) =>
    run(async () => {
      await studio.useLibraryEntry(seriesId, bucket, rowId, entryId);
      setPicking(null);
    }, "Could not use that one.");

  /**
   * The buyer's own picture. It goes into the catalog under this row's name and
   * is then attached, so a photograph they brought once is reusable on the next
   * show exactly like anything the engine built.
   */
  const useOwnImage = (bucket: Bucket, row: { id: string; name: string }, file: File) =>
    askThenRun(
      [row.id],
      async () => {
        const base64 = await fileToBase64(file);
        const mime = file.type || "image/jpeg";
        const entries = bucket === "props" ? (library?.objects ?? []) : (library?.places ?? []);
        const existing = entries.find((entry) => entry.name.trim().toLowerCase() === row.name.trim().toLowerCase());
        let entryId = existing?.id;
        if (entryId) {
          if (bucket === "props") await studio.uploadObjectImage(entryId, { image_base64: base64, image_mime_type: mime });
          else await studio.uploadPlaceImage(entryId, { image_base64: base64, image_mime_type: mime });
        } else {
          const created =
            bucket === "props"
              ? await studio.createObject({ name: row.name, image_base64: base64, image_mime_type: mime })
              : await studio.createPlace({ name: row.name, image_base64: base64, image_mime_type: mime });
          entryId = created.id;
        }
        await studio.useLibraryEntry(seriesId, bucket, row.id, entryId);
        await reloadLibrary();
      },
      "Could not use that picture.",
    );

  const add = (bucket: Bucket) =>
    run(async () => {
      const name = bucket === "props" ? addObject.trim() : addPlace.trim();
      if (!name) return;
      if (bucket === "props") {
        await studio.addProp(seriesId, { name });
        setAddObject("");
      } else {
        await studio.addLocation(seriesId, { name });
        setAddPlace("");
      }
    }, "Could not add that.");

  return (
    <div className="space-y-10">
      <p className="max-w-2xl text-sm text-secondary">
        The sets and the objects, kept apart from the cast. A place is built once as an empty plate and reused from
        several angles, so every scene there is the same room. An object is shot alone, so the same contract or letter
        looks the same every time it appears.
      </p>

      {saveError ? <p className="text-sm text-error-primary">{saveError}</p> : null}

      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Places</h3>
            <p className="mt-1 text-sm text-tertiary">
              {data.story_written
                ? "Every room the story writes. The shoot matches each scene to one of these plates."
                : "From the brief. Approve these now and the story is written to shoot in them."}
            </p>
          </div>
          {missingLocations.length ? (
            <Button color="secondary" size="sm" isDisabled={busy} onClick={() => void buildAll("locations")}>
              {busy ? "Working…" : `Build ${missingLocations.length} missing place${missingLocations.length > 1 ? "s" : ""}`}
            </Button>
          ) : null}
        </div>

        {data.locations.length ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.locations.map((row) => (
              <LocationCard
                key={row.id}
                row={row}
                busy={busy}
                working={isWorking(row)}
                entries={placeEntries}
                picking={picking === row.id}
                onPicking={(open) => setPicking(open ? row.id : null)}
                onBuild={(force) => void build("locations", row.id, force)}
                onRemove={() => void remove("locations", row.id)}
                onPick={(entryId) => void useEntry("locations", row.id, entryId)}
                onUpload={(file) => void useOwnImage("locations", row, file)}
              />
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-tertiary">No places yet.</p>
        )}

        <div className="mt-4 flex max-w-md gap-2">
          <Input
            aria-label="Add a place"
            placeholder="Add a place — penthouse kitchen"
            value={addPlace}
            onChange={setAddPlace}
          />
          <Button color="secondary" size="sm" isDisabled={busy || !addPlace.trim()} onClick={() => void add("locations")}>
            Add
          </Button>
        </div>
      </section>

      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Objects</h3>
            <p className="mt-1 text-sm text-tertiary">
              Props the plot turns on. These are things, not parts — a leaked NDA belongs here, not on the cast sheet.
            </p>
          </div>
          {missingProps.length ? (
            <Button color="secondary" size="sm" isDisabled={busy} onClick={() => void buildAll("props")}>
              {busy ? "Working…" : `Build ${missingProps.length} missing object${missingProps.length > 1 ? "s" : ""}`}
            </Button>
          ) : null}
        </div>

        {data.props.length ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.props.map((row) => (
              <PropCard
                key={row.id}
                row={row}
                busy={busy}
                working={isWorking(row)}
                entries={objectEntries}
                picking={picking === row.id}
                onPicking={(open) => setPicking(open ? row.id : null)}
                onBuild={(force) => void build("props", row.id, force)}
                onRemove={() => void remove("props", row.id)}
                onPick={(entryId) => void useEntry("props", row.id, entryId)}
                onUpload={(file) => void useOwnImage("props", row, file)}
              />
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-tertiary">No objects yet.</p>
        )}

        <div className="mt-4 flex max-w-md gap-2">
          <Input
            aria-label="Add an object"
            placeholder="Add an object — sealed letter"
            value={addObject}
            onChange={setAddObject}
          />
          <Button color="secondary" size="sm" isDisabled={busy || !addObject.trim()} onClick={() => void add("props")}>
            Add
          </Button>
        </div>
      </section>
    </div>
  );
}

function CardShell({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-xl border border-secondary bg-primary">{children}</div>;
}

function LocationCard({
  row,
  busy,
  working,
  entries,
  picking,
  onPicking,
  onBuild,
  onRemove,
  onPick,
  onUpload,
}: {
  row: DesignLocation;
  busy: boolean;
  working: boolean;
  entries: Entry[];
  picking: boolean;
  onPicking: (open: boolean) => void;
  onBuild: (force: boolean) => void;
  onRemove: () => void;
  onPick: (entryId: string) => void;
  onUpload: (file: File) => void;
}) {
  return (
    <CardShell>
      <Plate
        src={row.plate_url}
        chip={working ? "Building…" : statusChip(row.status, row.locked)}
        working={working}
      />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-tertiary">
              {row.origin === "story" ? "Written by the story" : row.origin === "buyer" ? "Yours" : "From the brief"}
            </div>
            <div className="mt-1 text-md font-semibold">{row.name}</div>
          </div>
          {row.locked ? (
            <Badge type="pill-color" color="success" size="sm">
              Shot
            </Badge>
          ) : null}
        </div>

        {row.lighting_lock ? <p className="mt-2 text-xs text-tertiary">{row.lighting_lock}</p> : null}

        {row.angles.length ? (
          <div className="mt-3">
            <div className="text-xs font-semibold text-tertiary">Same room, other angles</div>
            <div className="mt-2 flex gap-2">
              {row.angles.map((angle) => (
                <img
                  key={angle.angle}
                  src={angle.url}
                  alt={angle.angle}
                  className="h-16 w-10 rounded-md object-cover"
                />
              ))}
            </div>
          </div>
        ) : null}

        {row.error ? <p className="mt-2 text-xs text-error-primary">{row.error}</p> : null}

        {row.locked ? (
          <p className="mt-3 text-sm text-tertiary">This set is in footage now. Its look stays the same.</p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button color="secondary" size="sm" isDisabled={busy || working} onClick={() => onBuild(Boolean(row.plate_url))}>
                {working ? "Building…" : row.plate_url ? "Build it again" : "Build this place"}
              </Button>
              <UploadButton label="Use my own" busy={busy || working} onFile={onUpload} />
              <Button color="tertiary" size="sm" isDisabled={busy || working} onClick={() => onPicking(!picking)}>
                Library
              </Button>
              {row.origin === "story" ? null : (
                <Button color="tertiary" size="sm" isDisabled={busy || working} onClick={onRemove}>
                  Remove
                </Button>
              )}
            </div>
            {picking ? (
              <LibraryStrip entries={entries} busy={busy} onPick={onPick} onClose={() => onPicking(false)} />
            ) : null}
          </>
        )}
      </div>
    </CardShell>
  );
}

function PropCard({
  row,
  busy,
  working,
  entries,
  picking,
  onPicking,
  onBuild,
  onRemove,
  onPick,
  onUpload,
}: {
  row: DesignProp;
  busy: boolean;
  working: boolean;
  entries: Entry[];
  picking: boolean;
  onPicking: (open: boolean) => void;
  onBuild: (force: boolean) => void;
  onRemove: () => void;
  onPick: (entryId: string) => void;
  onUpload: (file: File) => void;
}) {
  return (
    <CardShell>
      <Plate src={row.still_url} chip={working ? "Building…" : statusChip(row.status, row.locked)} working={working} />
      <div className="p-4">
        <div className="text-xs font-semibold text-tertiary">
          {row.origin === "cast_device" ? "Story element" : row.origin === "buyer" ? "Yours" : "From the brief"}
        </div>
        <div className="mt-1 text-md font-semibold">{row.name}</div>
        {row.state ? <p className="mt-1 text-xs text-tertiary">{row.state} state</p> : null}
        {row.error ? <p className="mt-2 text-xs text-error-primary">{row.error}</p> : null}
        {row.locked ? (
          <p className="mt-3 text-sm text-tertiary">Already on screen. It stays the same object.</p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button color="secondary" size="sm" isDisabled={busy || working} onClick={() => onBuild(Boolean(row.still_url))}>
                {working ? "Building…" : row.still_url ? "Again" : "Build it"}
              </Button>
              <UploadButton label="Use my own" busy={busy || working} onFile={onUpload} />
              <Button color="tertiary" size="sm" isDisabled={busy || working} onClick={() => onPicking(!picking)}>
                Library
              </Button>
              <Button color="tertiary" size="sm" isDisabled={busy || working} onClick={onRemove}>
                Remove
              </Button>
            </div>
            {picking ? (
              <LibraryStrip entries={entries} busy={busy} onPick={onPick} onClose={() => onPicking(false)} />
            ) : null}
          </>
        )}
      </div>
    </CardShell>
  );
}
