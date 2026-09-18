import { CaretLeft, Folder } from "@phosphor-icons/react";
import { Input } from "@/components/base/input/input";
import {
  groupByPlaceFolder,
  type PlaceFolderId,
} from "@/drama-engine/craft/place.ts";
import { fuzzySearch } from "@/lib/fuzzy-search.ts";
import { cx } from "@/utils/cx";

export type PlaceFolderItem = {
  id: string;
  name: string;
  image_url?: string | null;
};

export function filterPlaces<T extends { name: string }>(
  items: readonly T[],
  query: string,
  extraOf?: (item: T) => readonly string[],
): T[] {
  return fuzzySearch(items, query, (item) => extraOf?.(item) ?? []);
}

export function foldersFor<T extends { name: string }>(items: readonly T[]) {
  return groupByPlaceFolder(items, (item) => item.name);
}

/** Search the catalog by name, folder, or extra words (a show, a tag). */
export function PlaceSearch({
  value,
  onChange,
  placeholder = "Find a place",
  ariaLabel = "Search catalog",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <div className="max-w-md">
      <Input aria-label={ariaLabel} placeholder={placeholder} value={value} onChange={onChange} />
    </div>
  );
}

/**
 * One folder in the catalog. The cover is the first plate inside, so the
 * buyer sees the room they already built instead of an empty icon.
 */
export function PlaceFolderTile({
  label,
  count,
  cover,
  onOpen,
}: {
  label: string;
  count: number;
  cover?: string | null;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex cursor-pointer items-center gap-3 rounded-xl border border-secondary bg-primary p-3 text-left transition hover:border-brand"
    >
      <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-secondary">
        {cover ? (
          <img src={cover} alt="" className="size-full object-cover" />
        ) : (
          <span className="grid size-full place-items-center text-tertiary">
            <Folder size={22} weight="fill" />
          </span>
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{label}</span>
        <span className="block text-xs text-tertiary">
          {count} {count === 1 ? "place" : "places"}
        </span>
      </span>
    </button>
  );
}

export function PlaceFolderBar({
  label,
  onBack,
}: {
  label: string;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex cursor-pointer items-center gap-1 text-sm font-semibold text-tertiary hover:text-secondary"
      >
        <CaretLeft size={16} weight="bold" />
        All places
      </button>
      <span className="text-tertiary">/</span>
      <span className="text-sm font-semibold">{label}</span>
    </div>
  );
}

export function PlaceFolderHeading({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count: number;
  open?: boolean;
  onToggle?: () => void;
}) {
  const title = (
    <>
      <Folder size={16} weight="fill" className="text-tertiary" />
      <span>{label}</span>
      <span className="font-medium text-tertiary">{count}</span>
    </>
  );
  if (!onToggle) {
    return <h4 className="flex items-center gap-2 text-sm font-semibold">{title}</h4>;
  }
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cx("flex cursor-pointer items-center gap-2 text-sm font-semibold", !open && "text-secondary")}
    >
      {title}
    </button>
  );
}

export function firstCover(items: ReadonlyArray<{ image_url?: string | null; plate_url?: string | null }>): string | null {
  for (const item of items) {
    const url = item.image_url ?? item.plate_url;
    if (url) return url;
  }
  return null;
}

export type OpenFolder = PlaceFolderId | "";
