import { useEffect, useState, type ReactNode } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { FilmStrip, House, Plus, Users } from "@phosphor-icons/react";
import { Button } from "@/components/base/buttons/button";
import { AttentionBell, AttentionPanel } from "@/components/drama/attention-panel.tsx";
import { Skeleton } from "@/components/drama/skeleton.tsx";
import { studio, type Account, type AttentionActivity, type AttentionItem } from "@/lib/api.ts";
import { readCache, writeCache } from "@/lib/cache.ts";
import { currentSession, signOut } from "@/lib/session.ts";
import { useLiveReload } from "@/lib/use-studio.ts";
import { cx } from "@/utils/cx";

const NAV = [
  { href: "/", label: "Home", icon: House },
  { href: "/series", label: "Shows", icon: FilmStrip },
  { href: "/actors", label: "Actors", icon: Users },
];

export function AppShell({ children }: { children: ReactNode }) {
  const page = usePageContext();
  const path = page.urlPathname;
  const [me, setMe] = useState<Account | null>(() => readCache<Account>("account"));
  const [attention, setAttention] = useState<AttentionItem[]>(() => readCache<{ items: AttentionItem[] }>("attention")?.items ?? []);
  const [activity, setActivity] = useState<AttentionActivity[]>(() => readCache<{ activity: AttentionActivity[] }>("attention")?.activity ?? []);
  const [deskOpen, setDeskOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    currentSession().then((session) => {
      if (!session && !window.localStorage.getItem("ds.access_token")) {
        window.location.href = "/login";
        return;
      }
      studio
        .account()
        .then((account) => {
          if (!cancelled) {
            writeCache("account", account);
            setMe(account);
          }
        })
        .catch(() => {
          if (!cancelled && !window.localStorage.getItem("ds.access_token")) {
            window.location.href = "/login";
          }
        });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadAttention = () =>
    studio
      .attention()
      .then((data) => {
        writeCache("attention", data);
        setAttention(data.items ?? []);
        setActivity(data.activity ?? []);
      })
      .catch(() => undefined);

  useEffect(() => {
    void loadAttention();
  }, []);

  useLiveReload(() => void loadAttention(), []);

  useEffect(() => {
    setDismissed(false);
  }, [attention.length]);

  const needsYou = attention.length > 0;
  const liveJob = activity.some((item) => item.state === "watching" || item.state === "cutting" || item.state === "fixing");
  const showDesk = deskOpen || (needsYou && !dismissed);
  const showSlots = (me?.slots_used ?? 0) >= 2;

  return (
    <div className="min-h-dvh bg-secondary_alt lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="hidden border-r border-secondary bg-primary lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:p-4">
        <div className="mb-5 flex items-center gap-2.5 px-2">
          <div className="grid size-8 place-items-center rounded-lg bg-linear-to-b from-brand-500 to-brand-700 text-sm font-extrabold text-white shadow-xs">
            DS
          </div>
          <b className="text-md tracking-tight">Drama Space</b>
          <div className="ml-auto">
            <AttentionBell
              count={attention.length}
              onToggle={() => {
                setDismissed(false);
                setDeskOpen((value) => !value);
              }}
            />
          </div>
        </div>
        <Button href="/new" color="primary" size="lg" className="w-full" iconLeading={Plus}>
          New show
        </Button>
        <nav className="mt-5 flex flex-col gap-0.5" aria-label="Primary">
          {NAV.map((item) => (
            <NavItem
              key={item.href}
              {...item}
              current={item.href === "/" ? path === "/" : path.startsWith(item.href)}
            />
          ))}
        </nav>
        <div className="mt-auto border-t border-secondary pt-4">
          {showSlots ? (
            <div className="mb-2.5 rounded-xl border border-secondary bg-secondary_alt p-3">
              <div className="mb-2 flex justify-between text-sm font-semibold">
                <span>Concurrent jobs</span>
                <span className="mono text-tertiary">
                  {me?.slots_used ?? 0} of {me?.slots_total ?? 4}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-brand-600"
                  style={{
                    width: `${Math.min(100, ((me?.slots_used ?? 0) / (me?.slots_total ?? 4)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
          <a href="/account" className="flex items-center gap-2.5 rounded-lg p-2 hover:bg-primary_hover">
            <span className="grid size-9 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
              {(me?.display_name || "DS").slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0 grow">
              {me ? (
                <>
                  <span className="block text-sm font-semibold">{me.display_name || "Account"}</span>
                  <span className="block text-xs text-tertiary">Drama Space</span>
                </>
              ) : (
                <>
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="mt-1.5 h-3 w-16" />
                </>
              )}
            </span>
          </a>
        </div>
      </aside>
      <div className="flex min-w-0 min-h-0 flex-col">
        <div className="relative flex min-w-0 flex-1 flex-col">
          {children}
          <div className="fixed right-4 bottom-20 z-30 lg:hidden">
            <AttentionBell
              count={attention.length}
              onToggle={() => {
                setDismissed(false);
                setDeskOpen((value) => !value);
              }}
            />
          </div>
          <nav className="sticky bottom-0 grid grid-cols-5 border-t border-secondary bg-primary px-1 pt-2 pb-3 lg:hidden" aria-label="Mobile">
            {[
              { href: "/", label: "Home" },
              { href: "/series", label: "Shows" },
              { href: "/actors", label: "Actors" },
              { href: "/new", label: "New" },
              { href: "/account", label: "Account" },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={cx(
                  "py-1.5 text-center text-[11px] font-medium",
                  (item.href === "/" ? path === "/" : path.startsWith(item.href))
                    ? "font-semibold text-brand-700"
                    : "text-tertiary",
                )}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </div>
      <AttentionPanel
        items={attention}
        activity={activity}
        open={showDesk}
        live={liveJob}
        onClose={() => {
          setDeskOpen(false);
          setDismissed(true);
        }}
        onChanged={() =>
          studio.attention().then((data) => {
            setAttention(data.items ?? []);
            setActivity(data.activity ?? []);
          })
        }
      />
    </div>
  );
}

function NavItem({
  href,
  label,
  icon: Icon,
  current,
}: {
  href: string;
  label: string;
  icon: typeof House;
  current: boolean;
}) {
  return (
    <a
      href={href}
      aria-current={current ? "page" : undefined}
      className={cx(
        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium",
        current ? "bg-brand-50 font-semibold text-brand-800" : "text-secondary hover:bg-primary_hover",
      )}
    >
      <Icon size={18} weight={current ? "fill" : "regular"} className={current ? "text-brand-600" : "text-quaternary"} />
      <span className="grow">{label}</span>
    </a>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="overflow-visible border-b border-secondary bg-primary px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[220px] grow">
          {eyebrow ? <div className="text-sm font-semibold text-tertiary">{eyebrow}</div> : null}
          <h1 className="pt-1 text-display-sm leading-tight font-semibold tracking-tight">{title}</h1>
          {subtitle ? <div className="mt-1 text-md text-tertiary">{subtitle}</div> : null}
        </div>
        {actions}
      </div>
    </header>
  );
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mx-auto w-full max-w-[1320px] px-4 py-8 sm:px-8", className)}>{children}</div>;
}

export async function logout() {
  await signOut();
  window.location.href = "/login";
}
