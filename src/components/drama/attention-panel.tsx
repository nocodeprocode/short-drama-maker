import { useEffect, useRef, useState } from "react";
import { Bell } from "@phosphor-icons/react";
import { Button } from "@/components/base/buttons/button";
import { Badge } from "@/components/base/badges/badges";
import { CTA } from "@/engine/present.ts";
import { studio, type AttentionActivity, type AttentionItem } from "@/lib/api.ts";
import { cx } from "@/utils/cx";

const RESOLVED_HOLD_MS = 12_000;

type VisibleActivity = AttentionActivity & { localState: AttentionActivity["state"] };

export function AttentionBell({
  count,
  onToggle,
  plain = false,
}: {
  count: number;
  open?: boolean;
  onToggle: () => void;
  plain?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={count ? `${count} items need you` : "Studio activity"}
      className={cx(
        "relative grid size-10 place-items-center rounded-full",
        plain
          ? count
            ? "text-warning-700"
            : "text-secondary"
          : cx("border bg-primary", count ? "border-warning-300 text-warning-700" : "border-secondary text-tertiary"),
      )}
    >
      <Bell size={18} weight={count ? "fill" : "regular"} />
      {count > 0 ? (
        <span className="absolute -top-1 -right-1 grid min-w-[18px] place-items-center rounded-full bg-warning-500 px-1 text-[10px] font-bold text-white">
          {count}
        </span>
      ) : null}
    </button>
  );
}

export function AttentionPanel({
  items,
  activity,
  open,
  live,
  onClose,
  onChanged,
}: {
  items: AttentionItem[];
  activity: AttentionActivity[];
  open: boolean;
  live?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [held, setHeld] = useState<VisibleActivity[]>([]);
  const previous = useRef<Map<string, AttentionActivity>>(new Map());

  useEffect(() => {
    const next = new Map(activity.map((item) => [item.id, item]));
    const merged: VisibleActivity[] = activity.map((item) => ({ ...item, localState: item.state }));
    for (const [id, prior] of previous.current) {
      if (!next.has(id) && (prior.state === "issue" || prior.state === "fixing")) {
        merged.push({
          ...prior,
          state: "resolved",
          localState: "resolved",
          title: "Issue resolved",
          detail: "The studio retried this step and the show is moving again.",
        });
      }
    }
    previous.current = next;
    setHeld(merged);
    const timer = window.setTimeout(() => {
      setHeld((current) => current.filter((item) => item.localState !== "resolved"));
    }, RESOLVED_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [activity]);

  const feed = held.length ? held : activity.map((item) => ({ ...item, localState: item.state }));

  return (
    <>
      {open ? (
        <button type="button" aria-label="Close inbox" className="fixed inset-0 z-30 bg-black/20" onClick={onClose} />
      ) : null}
      <aside
        className={cx(
          "fixed inset-x-0 bottom-0 z-40 flex max-h-[88dvh] w-full flex-col rounded-t-2xl border-t border-secondary bg-primary transition-transform duration-300",
          "lg:inset-y-0 lg:right-0 lg:left-auto lg:h-dvh lg:max-h-none lg:w-[360px] lg:rounded-none lg:border-t-0 lg:border-l",
          open ? "translate-y-0 lg:translate-x-0" : "translate-y-full lg:translate-y-0 lg:translate-x-full",
        )}
      >
        <div className="border-b border-secondary px-4 py-3">
          <div className="text-sm font-semibold">Needs you</div>
          <div className="text-xs text-tertiary">
            {items.length
              ? `${items.length} waiting for you`
              : live
                ? "A show is shooting. You can leave."
                : "We only stop if we need you."}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {feed.length === 0 ? (
            <div className="rounded-xl border border-secondary bg-secondary_alt p-4">
              <div className="text-sm font-semibold">All quiet</div>
              <p className="mt-1 text-sm text-secondary">You can close this. We will ring the bell if a show needs you.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {feed.map((item) => (
                <ActivityCard
                  key={`${item.id}-${item.localState}`}
                  item={item}
                  blocked={items.find((row) => row.production_id === item.production_id)}
                  onChanged={onChanged}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function ActivityCard({
  item,
  blocked,
  onChanged,
}: {
  item: VisibleActivity;
  blocked?: AttentionItem;
  onChanged: () => void;
}) {
  const state = blocked ? "issue" : item.localState;
  const color =
    state === "issue" ? "error" : state === "fixing" ? "warning" : state === "resolved" || state === "ready" ? "success" : "brand";
  const badge =
    state === "issue"
      ? "Needs you"
      : state === "fixing"
        ? "Retrying"
        : state === "resolved"
          ? "Resolved"
          : state === "ready"
            ? "Ready"
            : state === "cutting"
              ? "Cutting"
              : "Shooting";

  return (
    <div
      className={cx(
        "rounded-xl border p-4 transition-colors duration-500",
        state === "issue"
          ? "border-error-200 bg-error-50"
          : state === "fixing"
            ? "border-warning-200 bg-warning-50"
            : state === "resolved" || state === "ready"
              ? "border-success-200 bg-success-50"
              : "border-secondary bg-secondary_alt",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold">{item.series_title}</div>
        <Badge type="pill-color" color={color} size="sm">
          {badge}
        </Badge>
      </div>
      <div className="mt-2 text-sm font-semibold">{blocked?.title ?? item.title}</div>
      <p className="mt-1 text-sm text-secondary">{blocked?.detail ?? item.detail}</p>
      {state === "fixing" || state === "watching" || state === "cutting" ? (
        <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-tertiary">
          <span className="size-3.5 animate-spin rounded-full border-2 border-secondary border-t-brand-600" />
          {state === "fixing"
            ? "Retrying this step"
            : state === "cutting"
              ? "Cutting the episode"
              : "You can close this page"}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {blocked?.primary_action === "retry" ? (
          <Button color="primary" size="sm" onClick={() => studio.resume(blocked.production_id).then(onChanged)}>
            {CTA.retry}
          </Button>
        ) : null}
        {blocked?.primary_action === "use_best" ? (
          <Button color="primary" size="sm" onClick={() => studio.useBest(blocked.production_id).then(onChanged)}>
            {CTA.useBest}
          </Button>
        ) : null}
        <Button href={item.href} color="secondary" size="sm">
          Open show
        </Button>
      </div>
    </div>
  );
}
