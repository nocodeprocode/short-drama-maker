import { useEffect, useState, type ReactNode } from "react";
import { usePageContext } from "vike-react/usePageContext";
import { FilmStrip, House, MapPin, Package, Plus, Queue, Users, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@/components/base/buttons/button";
import { AttentionBell, AttentionPanel } from "@/components/drama/attention-panel.tsx";
import { BrandMark } from "@/components/drama/brand-mark.tsx";
import { Skeleton } from "@/components/drama/skeleton.tsx";
import { LEGAL_ENTITY } from "@/legal/entity.ts";
import { studio, type Account, type AttentionActivity, type AttentionItem } from "@/lib/api.ts";
import { readCache, writeCache } from "@/lib/cache.ts";
import { currentSession, signOut } from "@/lib/session.ts";
import { useLiveReload } from "@/lib/use-studio.ts";
import { cx } from "@/utils/cx";

const NAV = [
  { href: "/", label: "Home", icon: House },
  { href: "/series", label: "Shows", icon: FilmStrip },
  { href: "/productions", label: "Jobs", icon: Queue },
  { href: "/needs", label: "Needs you", icon: WarningCircle },
  { href: "/actors", label: "Actors", icon: Users },
  { href: "/places", label: "Places", icon: MapPin },
  { href: "/objects", label: "Objects", icon: Package },
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
    <div className="app-shell flex h-dvh min-h-dvh flex-col bg-secondary lg:grid lg:h-auto lg:min-h-dvh lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="hidden border-r border-secondary bg-primary lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:p-4">
        <div className="mb-5 flex items-center gap-2.5 px-2">
          <BrandMark size="sm" />
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
          New run
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
            <span className="grid size-9 place-items-center rounded-full bg-brand-solid text-sm font-semibold text-white">
              {(me?.display_name || "TH").slice(0, 2).toUpperCase()}
            </span>
            <span className="min-w-0 grow">
              {me ? (
                <>
                  <span className="block text-sm font-semibold">{me.display_name || "Account"}</span>
                  <span className="block text-xs text-tertiary">
                    {typeof me.credit_balance === "number" ? `Wallet $${Math.round(me.credit_balance)}` : LEGAL_ENTITY.product_name}
                  </span>
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
      <div className="app-column flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="app-topbar lg:hidden">
          <BrandMark size="sm" />
          <div className="ml-auto flex items-center gap-0.5">
            <a
              href="/new"
              aria-label="New run"
              className="grid size-10 place-items-center rounded-full text-brand-secondary"
            >
              <Plus size={22} weight="bold" />
            </a>
            <AttentionBell
              plain
              count={attention.length}
              onToggle={() => {
                setDismissed(false);
                setDeskOpen((value) => !value);
              }}
            />
            <a href="/account" aria-label="Account" className="grid size-10 place-items-center">
              <span className="grid size-8 place-items-center rounded-full bg-brand-solid text-[11px] font-semibold text-white">
                {(me?.display_name || "TH").slice(0, 2).toUpperCase()}
              </span>
            </a>
          </div>
        </header>
        <div className="app-stage relative flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        <nav className="app-tabbar lg:hidden" aria-label="Primary">
          {NAV.map((item) => {
            const current = item.href === "/" ? path === "/" : path.startsWith(item.href);
            const Icon = item.icon;
            const badge = item.href === "/needs" ? attention.length : 0;
            return (
              <a
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cx("app-tab", current ? "text-brand-secondary" : "text-tertiary")}
              >
                <span className="relative">
                  <Icon size={22} weight={current ? "fill" : "regular"} />
                  {badge > 0 ? (
                    <span className="absolute -top-1.5 -right-2 grid min-w-[16px] place-items-center rounded-full bg-warning-500 px-1 text-[9px] font-bold text-white">
                      {badge}
                    </span>
                  ) : null}
                </span>
                <span>{item.href === "/needs" ? "Needs" : item.label}</span>
              </a>
            );
          })}
        </nav>
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
        current ? "bg-secondary font-semibold text-primary" : "text-secondary hover:bg-primary_hover",
      )}
    >
      <Icon size={18} weight={current ? "fill" : "regular"} className={current ? "text-brand-secondary" : "text-quaternary"} />
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
    <header className="overflow-visible border-b border-secondary bg-primary px-4 py-4 lg:px-8 lg:py-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-start">
        <div className="min-w-0 grow lg:min-w-[220px]">
          {eyebrow ? <div className="text-xs font-semibold text-tertiary lg:text-sm">{eyebrow}</div> : null}
          <h1 className="pt-0.5 font-display text-2xl leading-tight font-semibold tracking-tight lg:text-display-sm">{title}</h1>
          {subtitle ? <div className="mt-1 text-sm text-tertiary lg:text-md">{subtitle}</div> : null}
        </div>
        {actions ? (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center [&>*]:w-full sm:[&>*]:w-auto">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mx-auto w-full max-w-[1320px] px-4 py-5 lg:px-8 lg:py-8", className)}>{children}</div>;
}

export async function logout() {
  await signOut();
  window.location.href = "/login";
}
