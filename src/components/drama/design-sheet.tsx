import { useEffect, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
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
import { isElevator, roomAngleLabel, roomAnglesFor } from "@/drama-engine/craft/place.ts";
import { isReadableDocument, objectViewLabel, objectViews } from "@/engine/pipeline/prop-bible.ts";
import {
  filterPlaces,
  firstCover,
  foldersFor,
  PlaceFolderHeading,
  PlaceFolderTile,
  PlaceSearch,
} from "@/components/drama/place-folders.tsx";
import { useStudio } from "@/lib/use-studio.ts";
import { prepareImageUpload } from "@/lib/image-upload.ts";
import { cx } from "@/utils/cx";

type StillPreview = { src: string; title: string; detail?: string };

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
  places,
}: {
  entries: Entry[];
  busy: boolean;
  onPick: (entryId: string) => void;
  onClose: () => void;
  /** File the catalog into rooms / streets / cars so a long list is browsable. */
  places?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState("");
  const shown = filterPlaces(entries, query);
  const folders = places ? foldersFor(shown) : [];
  const open = places && !query.trim() && folder ? folders.find((row) => row.id === folder) : null;
  const grid = open ? open.items : places && !query.trim() && folders.length > 1 ? [] : shown;

  return (
    <div className="mt-3 rounded-lg bg-secondary p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-secondary">From your library</span>
        <button type="button" onClick={onClose} className="cursor-pointer text-xs font-semibold text-tertiary hover:text-secondary">
          Close
        </button>
      </div>
      {entries.length > 4 || places ? (
        <div className="mt-2">
          <PlaceSearch value={query} onChange={setQuery} placeholder={places ? "Find a room or street" : "Find an object"} />
        </div>
      ) : null}
      {open ? (
        <button
          type="button"
          onClick={() => setFolder("")}
          className="mt-2 cursor-pointer text-xs font-semibold text-tertiary hover:text-secondary"
        >
          All places
        </button>
      ) : null}
      {places && !query.trim() && !open && folders.length > 1 ? (
        <div className="mt-2 grid grid-cols-1 gap-2">
          {folders.map((row) => (
            <PlaceFolderTile
              key={row.id}
              label={row.label}
              count={row.items.length}
              cover={firstCover(row.items)}
              onOpen={() => setFolder(row.id)}
            />
          ))}
        </div>
      ) : null}
      {grid.length ? (
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {grid.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(entry.id)}
                className="block w-full cursor-pointer overflow-hidden rounded-md text-left ring-1 ring-secondary ring-inset transition hover:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="poster no-shade ratio-34 block">
                  {entry.image_url ? <img src={entry.image_url} alt="" className="poster-photo" /> : null}
                </span>
                <span className="block truncate px-1.5 py-1 text-xs font-semibold">{entry.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : entries.length === 0 ? (
        <p className="mt-2 text-xs text-tertiary">
          Nothing built yet. Anything you build here is added to your library and can be reused on your next show.
        </p>
      ) : query.trim() ? (
        <p className="mt-2 text-xs text-tertiary">Nothing matches that.</p>
      ) : null}
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
function Plate({
  src,
  chip,
  working,
  label,
  onOpen,
}: {
  src?: string | null;
  chip?: string;
  working?: boolean;
  label?: string;
  onOpen?: () => void;
}) {
  const inner = (
    <>
      {src ? <img src={src} alt={label ?? ""} className="poster-photo" /> : null}
      {chip ? <span className={cx("pchip", working && "is-working")}>{chip}</span> : null}
      {working ? (
        <span className="pbar is-indeterminate">
          <i />
        </span>
      ) : null}
    </>
  );
  if (src && onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={cx("poster no-shade ratio-34 block w-full cursor-pointer text-left", working && "is-working")}
        aria-label={label ? `Preview ${label}` : "Preview this still"}
      >
        {inner}
      </button>
    );
  }
  return <div className={cx("poster no-shade ratio-34", working && "is-working")}>{inner}</div>;
}

function PreviewDialog({ preview, onClose }: { preview: StillPreview; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={preview.title}>
      <button type="button" aria-label="Close preview" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 max-h-[92vh] w-full max-w-sm overflow-auto rounded-xl bg-primary p-4 shadow-xl">
        <img src={preview.src} alt={preview.title} className="mx-auto max-h-[70vh] w-auto rounded-lg object-contain" />
        <div className="mt-3 text-md font-semibold">{preview.title}</div>
        {preview.detail ? <p className="mt-2 whitespace-pre-wrap text-xs text-tertiary">{preview.detail}</p> : null}
        <div className="mt-3">
          <Button color="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function AngleSlot({
  label,
  url,
  onOpen,
}: {
  label: string;
  url?: string | null;
  onOpen: (src: string, title: string) => void;
}) {
  if (url) {
    return (
      <button type="button" onClick={() => onOpen(url, label)} className="min-w-0 cursor-pointer text-left">
        <img src={url} alt={label} className="aspect-[9/16] w-full rounded-md object-cover" />
        <div className="mt-1 truncate text-[10px] text-tertiary">{label}</div>
      </button>
    );
  }
  return (
    <div className="min-w-0">
      <div className="flex aspect-[9/16] items-center justify-center rounded-md bg-secondary px-1 text-center text-[10px] text-tertiary">
        Not built
      </div>
      <div className="mt-1 truncate text-[10px] text-tertiary">{label}</div>
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addPlace, setAddPlace] = useState("");
  const [addObject, setAddObject] = useState("");
  const [placeQuery, setPlaceQuery] = useState("");
  /** Which card has its library open. Only one at a time keeps the grid calm. */
  const [picking, setPicking] = useState<string | null>(null);
  const [preview, setPreview] = useState<StillPreview | null>(null);
  // Rows the buyer just asked for. The request takes a few seconds and the card
  // has to change on the click, not when the server gets back to us.
  const [asked, setAsked] = useState<ReadonlySet<string>>(() => new Set());
  /** Places and papers we already queued a fill for, so polling cannot loop. */
  const filled = useRef(new Set<string>());

  useEffect(() => {
    if (!data) return;
    const places = data.locations.filter((row) => {
      if (!row.plate_url || row.locked || row.status === "building" || row.status === "failed") return false;
      if (filled.current.has(row.id)) return false;
      const wanted = roomAnglesFor(row.name).length;
      const have = row.angles?.length ?? 0;
      return have < wanted;
    });
    const papers = data.props.filter((row) => {
      if (!row.still_url || row.locked || row.status === "building" || row.status === "failed") return false;
      if (!isReadableDocument(row.name) || row.document_text) return false;
      if (filled.current.has(row.id)) return false;
      return true;
    });
    if (!places.length && !papers.length) return;
    const ids = [...places, ...papers].map((row) => row.id);
    for (const id of ids) filled.current.add(id);
    setAsked((current) => {
      const next = new Set(current);
      for (const id of ids) next.add(id);
      return next;
    });
    setSaveError(null);
    void (async () => {
      try {
        for (const row of places) {
          const force = isElevator(row.name) && (row.angles?.length ?? 0) === 0;
          await studio.buildDesign(seriesId, "locations", row.id, force ? { force: true } : {});
        }
        for (const row of papers) {
          await studio.buildDesign(seriesId, "props", row.id, { force: true });
        }
        await reload();
      } catch (caught) {
        setSaveError(caught instanceof Error ? caught.message : "Could not finish those stills.");
      } finally {
        setAsked((current) => {
          const next = new Set(current);
          for (const id of ids) next.delete(id);
          return next;
        });
      }
    })();
    // reload is recreated each render; filled.current stops a second enqueue.
  }, [data, seriesId]);

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
    setSaveError(null);
    try {
      await work();
      await reload();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : fallback);
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
        const upload = await prepareImageUpload(file);
        const base64 = upload.base64;
        const mime = upload.mimeType;
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

  const shownPlaces = filterPlaces(data.locations, placeQuery, (row) => [row.note, row.lighting_lock ?? ""]);
  const placeFolders = foldersFor(shownPlaces);

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
        The sets and the objects, kept apart from the cast. A place is built as an empty set from every wall plus above,
        so later scenes keep the same room. An object is shot alone, and from the other side when it has two faces, so
        the same contract or letter looks the same every time it appears.
      </p>

      {saveError ? <p className="text-sm text-error-primary">{saveError}</p> : null}

      <section>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Places</h3>
            <p className="mt-1 text-sm text-tertiary">
              {data.story_written
                ? "Every room the story writes, filed by the kind of place it is."
                : "From the brief. Approve these now and the story is written to shoot in them."}
            </p>
          </div>
          {missingLocations.length ? (
            <Button color="secondary" size="sm" onClick={() => void buildAll("locations")}>
              {`Build ${missingLocations.length} missing place${missingLocations.length > 1 ? "s" : ""}`}
            </Button>
          ) : null}
        </div>

        {data.locations.length ? (
          <div className="mt-4 space-y-4">
            <PlaceSearch value={placeQuery} onChange={setPlaceQuery} placeholder="Find a room, street, or car" />
            {shownPlaces.length === 0 ? (
              <p className="text-sm text-tertiary">No place matches that.</p>
            ) : (
              placeFolders.map((group) => (
                <section key={group.id} className="space-y-3">
                  <PlaceFolderHeading label={group.label} count={group.items.length} />
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {group.items.map((row) => (
                      <LocationCard
                        key={row.id}
                        row={row}
                        working={isWorking(row)}
                        entries={placeEntries}
                        picking={picking === row.id}
                        onPicking={(open) => setPicking(open ? row.id : null)}
                        onBuild={(force) => void build("locations", row.id, force)}
                        onRemove={() => void remove("locations", row.id)}
                        onPick={(entryId) => void useEntry("locations", row.id, entryId)}
                        onUpload={(file) => void useOwnImage("locations", row, file)}
                        onPreview={setPreview}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
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
          <Button color="secondary" size="sm" isDisabled={!addPlace.trim()} onClick={() => void add("locations")}>
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
            <Button color="secondary" size="sm" onClick={() => void buildAll("props")}>
              {`Build ${missingProps.length} missing object${missingProps.length > 1 ? "s" : ""}`}
            </Button>
          ) : null}
        </div>

        {data.props.length ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.props.map((row) => (
              <PropCard
                key={row.id}
                row={row}
                working={isWorking(row)}
                entries={objectEntries}
                picking={picking === row.id}
                onPicking={(open) => setPicking(open ? row.id : null)}
                onBuild={(force) => void build("props", row.id, force)}
                onRemove={() => void remove("props", row.id)}
                onPick={(entryId) => void useEntry("props", row.id, entryId)}
                onUpload={(file) => void useOwnImage("props", row, file)}
                onPreview={setPreview}
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
          <Button color="secondary" size="sm" isDisabled={!addObject.trim()} onClick={() => void add("props")}>
            Add
          </Button>
        </div>
      </section>
      {preview ? <PreviewDialog preview={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}

function CardShell({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-xl border border-secondary bg-primary">{children}</div>;
}

function LocationCard({
  row,
  working,
  entries,
  picking,
  onPicking,
  onBuild,
  onRemove,
  onPick,
  onUpload,
  onPreview,
}: {
  row: DesignLocation;
  working: boolean;
  entries: Entry[];
  picking: boolean;
  onPicking: (open: boolean) => void;
  onBuild: (force: boolean) => void;
  onRemove: () => void;
  onPick: (entryId: string) => void;
  onUpload: (file: File) => void;
  onPreview: (preview: StillPreview) => void;
}) {
  const wanted = roomAnglesFor(row.name);
  const byAngle = new Map((row.angles ?? []).map((angle) => [angle.angle, angle.url]));
  const packIncomplete = Boolean(row.plate_url) && wanted.some((view) => !byAngle.get(view.angle));
  const openStill = (src: string, title: string) => onPreview({ src, title, detail: row.lighting_lock ?? undefined });

  return (
    <CardShell>
      <Plate
        src={row.plate_url}
        chip={working ? "Building…" : statusChip(row.status, row.locked)}
        working={working}
        label={row.name}
        onOpen={row.plate_url ? () => openStill(row.plate_url!, row.name) : undefined}
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

        {wanted.length ? (
          <div className="mt-3">
            <div className="text-xs font-semibold text-tertiary">
              {isElevator(row.name) ? "Every wall of the cab" : "Every wall, plus above"}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {wanted.map((view) => (
                <AngleSlot
                  key={view.angle}
                  label={roomAngleLabel(view.angle, row.name)}
                  url={byAngle.get(view.angle)}
                  onOpen={(src, title) => openStill(src, `${row.name} — ${title}`)}
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
              {packIncomplete ? (
                <Button color="secondary" size="sm" isDisabled={working} onClick={() => onBuild(false)}>
                  {working ? "Building…" : "Build the other walls"}
                </Button>
              ) : null}
              <Button
                color={packIncomplete ? "tertiary" : "secondary"}
                size="sm"
                isDisabled={working}
                onClick={() => onBuild(Boolean(row.plate_url))}
              >
                {working ? "Building…" : row.plate_url ? "Build it again" : "Build this place"}
              </Button>
              <UploadButton label="Use my own" busy={working} onFile={onUpload} />
              <Button color="tertiary" size="sm" isDisabled={working} onClick={() => onPicking(!picking)}>
                Library
              </Button>
              {row.origin === "story" ? null : (
                <Button color="tertiary" size="sm" isDisabled={working} onClick={onRemove}>
                  Remove
                </Button>
              )}
            </div>
            {picking ? (
              <LibraryStrip entries={entries} busy={working} onPick={onPick} onClose={() => onPicking(false)} places />
            ) : null}
          </>
        )}
      </div>
    </CardShell>
  );
}

function PropCard({
  row,
  working,
  entries,
  picking,
  onPicking,
  onBuild,
  onRemove,
  onPick,
  onUpload,
  onPreview,
}: {
  row: DesignProp;
  working: boolean;
  entries: Entry[];
  picking: boolean;
  onPicking: (open: boolean) => void;
  onBuild: (force: boolean) => void;
  onRemove: () => void;
  onPick: (entryId: string) => void;
  onUpload: (file: File) => void;
  onPreview: (preview: StillPreview) => void;
}) {
  const wanted = objectViews(row.name);
  const byAngle = new Map((row.angles ?? []).map((angle) => [angle.angle, angle.url]));
  const openStill = (src: string, title: string) =>
    onPreview({ src, title, detail: row.document_text ?? undefined });

  return (
    <CardShell>
      <Plate
        src={row.still_url}
        chip={working ? "Building…" : statusChip(row.status, row.locked)}
        working={working}
        label={row.name}
        onOpen={row.still_url ? () => openStill(row.still_url!, row.name) : undefined}
      />
      <div className="p-4">
        <div className="text-xs font-semibold text-tertiary">
          {row.origin === "cast_device" ? "Story element" : row.origin === "buyer" ? "Yours" : "From the brief"}
        </div>
        <div className="mt-1 text-md font-semibold">{row.name}</div>
        {row.state ? <p className="mt-1 text-xs text-tertiary">{row.state} state</p> : null}
        {row.document_text ? (
          <div className="mt-2">
            <div className="text-xs font-semibold text-tertiary">What it says</div>
            <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-xs text-tertiary">{row.document_text}</p>
          </div>
        ) : null}
        {wanted.length ? (
          <div className="mt-3">
            <div className="text-xs font-semibold text-tertiary">Other views</div>
            <div className="mt-2 flex gap-2">
              {wanted.map((view) => (
                <div key={view.angle} className="w-16 shrink-0">
                  <AngleSlot
                    label={objectViewLabel(view.angle)}
                    url={byAngle.get(view.angle)}
                    onOpen={(src, title) => openStill(src, `${row.name} — ${title}`)}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {row.error ? <p className="mt-2 text-xs text-error-primary">{row.error}</p> : null}
        {row.locked ? (
          <p className="mt-3 text-sm text-tertiary">Already on screen. It stays the same object.</p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button color="secondary" size="sm" isDisabled={working} onClick={() => onBuild(Boolean(row.still_url))}>
                {working ? "Building…" : row.still_url ? "Again" : "Build it"}
              </Button>
              <UploadButton label="Use my own" busy={working} onFile={onUpload} />
              <Button color="tertiary" size="sm" isDisabled={working} onClick={() => onPicking(!picking)}>
                Library
              </Button>
              <Button color="tertiary" size="sm" isDisabled={working} onClick={onRemove}>
                Remove
              </Button>
            </div>
            {picking ? (
              <LibraryStrip entries={entries} busy={working} onPick={onPick} onClose={() => onPicking(false)} />
            ) : null}
          </>
        )}
      </div>
    </CardShell>
  );
}
