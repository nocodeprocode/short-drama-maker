import { Badge } from "@/components/base/badges/badges";
import { Poster } from "@/components/drama/poster.tsx";
import { Skeleton } from "@/components/drama/skeleton.tsx";
import type { Character, CharacterRef } from "@/lib/api.ts";
import { cx } from "@/utils/cx";

export function CastCard({
  href,
  name,
  eyebrow,
  description,
  stillUrl,
  refs,
  locked,
  actorName,
  emptyLabel = "Casting",
}: {
  href: string;
  name: string;
  eyebrow?: string;
  description?: string;
  stillUrl?: string | null;
  refs?: CharacterRef[];
  locked?: boolean;
  actorName?: string | null;
  emptyLabel?: string;
}) {
  const pack = (refs ?? []).filter((item) => item.url !== stillUrl).slice(0, 4);
  return (
    <a href={href} className="block overflow-hidden rounded-xl border border-secondary bg-primary">
      <Poster src={stillUrl} title={stillUrl ? undefined : name} chip={stillUrl ? undefined : emptyLabel} ratio="34" />
      <div className="p-4">
        {eyebrow ? <div className="text-xs font-semibold text-tertiary">{eyebrow}</div> : null}
        <div className="mt-1 flex items-start justify-between gap-2">
          <div className="text-lg font-semibold">{name}</div>
          {locked != null ? (
            <Badge type="pill-color" color={locked ? "success" : "gray"} size="sm">
              {locked ? "Ready" : "Casting"}
            </Badge>
          ) : null}
        </div>
        {actorName ? <p className="mt-1 text-sm text-tertiary">Played by {actorName}</p> : null}
        {description ? <p className="mt-2 line-clamp-3 text-sm text-tertiary">{description}</p> : null}
        {pack.length ? (
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {pack.map((item) => (
              <img key={item.kind} src={item.url} alt={item.label} className="aspect-[3/4] w-full rounded-md object-cover" />
            ))}
          </div>
        ) : null}
      </div>
    </a>
  );
}

export function CharacterPack({
  stillUrl,
  refs,
  emptyLabel = "Casting",
}: {
  stillUrl?: string | null;
  refs?: CharacterRef[];
  emptyLabel?: string;
}) {
  const pack = refs ?? [];
  const hero = stillUrl ?? pack[0]?.url ?? null;
  const rest = pack.filter((item) => item.url !== hero);
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <Poster src={hero} chip={hero ? undefined : emptyLabel} ratio="34" className="max-w-sm" />
      <div className={cx("grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2")}>
        {rest.map((item) => (
          <figure key={item.kind} className="min-w-0">
            <img src={item.url} alt={item.label} className="aspect-[3/4] w-full rounded-lg object-cover" />
            <figcaption className="mt-1.5 text-xs font-medium text-tertiary">{item.label}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

export function CastCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-secondary bg-primary">
      <Skeleton className="aspect-[3/4] w-full" />
      <div className="p-4">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-2 h-5 w-36" />
        <Skeleton className="mt-3 h-4 w-full" />
      </div>
    </div>
  );
}

export function characterFromRow(character: Character) {
  return {
    href: `/characters/${character.id}`,
    name: character.name,
    eyebrow: character.series_title,
    description: character.description,
    stillUrl: character.still_url,
    refs: character.refs,
    locked: character.locked,
    actorName: character.actor_name,
  };
}
