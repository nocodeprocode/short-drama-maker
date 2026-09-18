import { useRef, useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { PageBody, PageHeader } from "@/components/drama/app-shell.tsx";
import { CastCardSkeleton } from "@/components/drama/cast-card.tsx";
import { CatalogPagination, pageItems } from "@/components/drama/catalog-pagination.tsx";
import { ConfirmDialog } from "@/components/drama/confirm-dialog.tsx";
import {
  filterPlaces,
  firstCover,
  foldersFor,
  PlaceFolderBar,
  PlaceFolderHeading,
  PlaceFolderTile,
  PlaceSearch,
  type OpenFolder,
} from "@/components/drama/place-folders.tsx";
import { LoadError } from "@/components/drama/skeleton.tsx";
import { roomAngleLabel } from "@/drama-engine/craft/place.ts";
import { studio, type PlaceEntry } from "@/lib/api.ts";
import { prepareImageUpload } from "@/lib/image-upload.ts";
import { useStudio } from "@/lib/use-studio.ts";
import { cx } from "@/utils/cx";

const IMAGE_TYPES = "image/png,image/jpeg,image/webp";
const PAGE_SIZE = 12;

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
function Plate({
  src,
  chip,
  working,
  onOpen,
}: {
  src?: string | null;
  chip?: string;
  working?: boolean;
  onOpen?: () => void;
}) {
  const content = (
    <>
      {src ? <img src={src} alt="" className="poster-photo" /> : null}
      {chip ? <span className={cx("pchip", working && "is-working")}>{chip}</span> : null}
      {working ? (
        <span className="pbar is-indeterminate">
          <i />
        </span>
      ) : null}
    </>
  );
  return src && onOpen ? (
    <button type="button" onClick={onOpen} className={cx("poster no-shade ratio-34 block w-full cursor-pointer", working && "is-working")}>
      {content}
    </button>
  ) : (
    <div className={cx("poster no-shade ratio-34", working && "is-working")}>{content}</div>
  );
}

export default function Page() {
  const { data, error, reload } = useStudio("places", () => studio.places());
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState<OpenFolder>("");
  const [page, setPage] = useState(1);

  if (error && !data) return <LoadError message={error} onRetry={() => void reload()} />;

  const searching = query.trim().length > 0;
  const shown = data
    ? filterPlaces(data.items, query, (place) => [...place.tags, ...place.shows, place.notes, place.lighting_lock ?? ""])
    : [];
  const folders = foldersFor(shown);
  const open = !searching && folder ? folders.find((row) => row.id === folder) : null;
  const cards = open ? open.items : searching ? shown : [];
  const pagedCards = pageItems(cards, page, PAGE_SIZE);
  const pagedSearchIds = new Set(pageItems(shown, page, PAGE_SIZE).map((place) => place.id));

  return (
    <>
      <PageHeader
        title="Places"
        subtitle="Your catalog of sets, filed by the kind of place they are. A place is built once as an empty plate and reused, so every scene there is the same room."
      />
      <PageBody>
        {data && data.items.length ? (
          <div className="mb-5 space-y-4">
            <PlaceSearch
              value={query}
              onChange={(value) => {
                setQuery(value);
                setPage(1);
              }}
              placeholder="Find a room, street, car, or show"
              ariaLabel="Find a place"
            />
            {searching ? (
              <p className="text-xs text-tertiary">
                {shown.length ? `${shown.length} ${shown.length === 1 ? "place" : "places"}` : "Nothing matches that."}
              </p>
            ) : open ? (
              <PlaceFolderBar label={open.label} onBack={() => {
                setFolder("");
                setPage(1);
              }} />
            ) : null}
          </div>
        ) : null}

        {!data ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <CastCardSkeleton key={index} />
            ))}
          </div>
        ) : null}

        {data && data.items.length && !searching && !open ? (
          folders.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {folders.map((row) => (
                <PlaceFolderTile
                  key={row.id}
                  label={row.label}
                  count={row.items.length}
                  cover={firstCover(row.items)}
                  onOpen={() => {
                    setFolder(row.id);
                    setPage(1);
                  }}
                />
              ))}
            </div>
          ) : null
        ) : null}

        {searching && folders.length ? (
          <div className="space-y-8">
            {folders.map((row) => (
              row.items.some((place) => pagedSearchIds.has(place.id)) ? <section key={row.id} className="space-y-3">
                <PlaceFolderHeading label={row.label} count={row.items.length} />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {row.items.filter((place) => pagedSearchIds.has(place.id)).map((place) => (
                    <PlaceCard key={place.id} place={place} onChanged={() => void reload()} />
                  ))}
                </div>
              </section> : null
            ))}
          </div>
        ) : null}

        {cards.length && !searching ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pagedCards.map((place) => (
              <PlaceCard key={place.id} place={place} onChanged={() => void reload()} />
            ))}
          </div>
        ) : null}
        {searching ? (
          <CatalogPagination page={page} pageSize={PAGE_SIZE} totalItems={shown.length} noun="places" onPageChange={setPage} />
        ) : open ? (
          <CatalogPagination page={page} pageSize={PAGE_SIZE} totalItems={cards.length} noun="places" onPageChange={setPage} />
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
        {data && data.items.length > 0 && searching && shown.length === 0 ? (
          <p className="text-sm text-tertiary">No place matches that.</p>
        ) : null}

        {data ? <AddPlace onAdded={() => void reload()} /> : null}
      </PageBody>
    </>
  );
}

function PlaceCard({ place, onChanged }: { place: PlaceEntry; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(place.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
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
      setConfirmRemove(true);
      return;
    }
    void run(() => studio.deletePlace(place.id), "Could not remove this place.");
  }

  return (
    <div className="overflow-hidden rounded-xl border border-secondary bg-primary">
      <Plate
        src={place.image_url}
        chip={statusChip(place)}
        working={building}
        onOpen={place.image_url ? () => setPreview({ url: place.image_url!, label: `${place.name} — Master` }) : undefined}
      />
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
        {(place.angles ?? []).length ? (
          <div className="mt-3">
            <p className="text-xs font-semibold text-tertiary">Generated views</p>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {(place.angles ?? []).map((angle) => {
                const label = roomAngleLabel(angle.angle, place.name);
                return (
                  <button
                    key={angle.angle}
                    type="button"
                    onClick={() => setPreview({ url: angle.url, label: `${place.name} — ${label}` })}
                    className="min-w-0 cursor-pointer text-left"
                  >
                    <img src={angle.url} alt={label} className="aspect-[9/16] w-full rounded-md object-cover" />
                    <span className="mt-1 block truncate text-[10px] text-tertiary">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : place.image_url && !building ? (
          <p className="mt-3 text-xs text-tertiary">The alternate views have not been built yet.</p>
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
                  const upload = await prepareImageUpload(file);
                  await studio.uploadPlaceImage(place.id, {
                    image_base64: upload.base64,
                    image_mime_type: upload.mimeType,
                  });
                }, "Could not use that picture.");
              }}
            />
          </div>
        )}

        {error ? <p className="mt-2 text-sm text-error-primary">{error}</p> : null}
      </div>
      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={preview.label}>
          <button type="button" aria-label="Close preview" className="absolute inset-0 bg-black/60" onClick={() => setPreview(null)} />
          <div className="relative z-10 w-full max-w-lg rounded-xl bg-primary p-4 shadow-xl">
            <img src={preview.url} alt={preview.label} className="mx-auto max-h-[78vh] rounded-lg object-contain" />
            <div className="mt-3 text-sm font-semibold">{preview.label}</div>
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmRemove}
        title={`Remove ${place.name}?`}
        description={`${place.name} is used in ${place.shows.join(", ")}. Those shows keep their own copy of the room, but it will be removed from your catalog.`}
        confirmLabel="Remove place"
        pending={busy}
        onOpenChange={setConfirmRemove}
        onConfirm={() => {
          setConfirmRemove(false);
          void run(() => studio.deletePlace(place.id), "Could not remove this place.");
        }}
      />
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
              const upload = await prepareImageUpload(file);
              await studio.createPlace({
                name: value,
                image_base64: upload.base64,
                image_mime_type: upload.mimeType,
              });
            });
          }}
        />
      </div>
    </div>
  );
}
