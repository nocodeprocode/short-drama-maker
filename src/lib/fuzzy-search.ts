import Fuse from "fuse.js";

export function fuzzySearch<T extends { name: string }>(
  items: readonly T[],
  query: string,
  extraOf: (item: T) => readonly string[] = () => [],
): T[] {
  const needle = query.trim();
  if (!needle) return [...items];

  const records = items.map((item) => ({
    item,
    name: item.name,
    search: [item.name, ...extraOf(item)].filter(Boolean).join(" "),
  }));

  return new Fuse(records, {
    keys: [
      { name: "name", weight: 0.7 },
      { name: "search", weight: 0.3 },
    ],
    threshold: 0.36,
    distance: 120,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 2,
    shouldSort: true,
  })
    .search(needle)
    .map((result) => result.item.item);
}
