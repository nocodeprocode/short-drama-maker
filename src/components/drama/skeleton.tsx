import type { ReactNode } from "react";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";

function Body({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mx-auto w-full max-w-[1320px] px-4 py-8 sm:px-8", className)}>{children}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("ds-skeleton", className)} />;
}

export function PageHeaderSkeleton({ subtitle = true }: { subtitle?: boolean }) {
  return (
    <header className="border-b border-secondary bg-primary px-4 py-6 sm:px-8">
      <Skeleton className="h-9 w-56" />
      {subtitle ? <Skeleton className="mt-3 h-5 w-80 max-w-full" /> : null}
    </header>
  );
}

export function PosterGridSkeleton({ count = 6, cols = "shows" }: { count?: number; cols?: "shows" | "home" | "jobs" }) {
  const grid =
    cols === "home"
      ? "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6"
      : cols === "jobs"
        ? "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4"
        : "grid-cols-2 sm:grid-cols-3 xl:grid-cols-5";
  return (
    <div className={cx("grid gap-5", grid)}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index}>
          <Skeleton className="aspect-[2/3] w-full" />
          <Skeleton className="mt-2.5 h-4 w-3/4" />
          <Skeleton className="mt-1.5 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function HomeSkeleton() {
  return (
    <>
      <PageHeaderSkeleton />
      <Body>
        <div className="mb-10 flex flex-col gap-3 rounded-2xl border border-secondary bg-primary p-5 sm:flex-row sm:items-center">
          <Skeleton className="aspect-[2/3] w-16 shrink-0" />
          <div className="min-w-0 grow">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="mt-3 h-4 w-72 max-w-full" />
            <Skeleton className="mt-4 h-2 w-full" />
          </div>
          <Skeleton className="h-10 w-28" />
        </div>
        <Skeleton className="mb-4 h-6 w-28" />
        <PosterGridSkeleton cols="home" />
      </Body>
    </>
  );
}

export function LiveShowSkeleton() {
  return (
    <>
      <PageHeaderSkeleton />
      <Body>
        <Skeleton className="mb-5 h-24 w-full" />
        <div className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      </Body>
    </>
  );
}

export function ShowDetailSkeleton() {
  return (
    <>
      <PageHeaderSkeleton />
      <Body>
        <div className="mb-5 flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-20" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 2 }).map((_, index) => (
            <Skeleton key={index} className="h-36 w-full" />
          ))}
        </div>
      </Body>
    </>
  );
}

export function EpisodeSkeleton() {
  return (
    <>
      <PageHeaderSkeleton />
      <Body>
        <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,360px)_1fr]">
          <div>
            <Skeleton className="aspect-[9/16] w-full rounded-xl" />
            <div className="mt-3 flex gap-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="aspect-[9/16] w-[72px] shrink-0" />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-secondary bg-primary p-6">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="mt-5 h-10 w-36" />
          </div>
        </div>
      </Body>
    </>
  );
}

export function StudioSkeleton() {
  return (
    <div className="flex min-h-[calc(100dvh-56px)] flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-secondary bg-primary px-6 py-4">
        <div className="grow">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-6 w-64" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-10 w-32" />
      </header>
      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[212px_1fr_348px]">
        <aside className="hidden space-y-2 border-r border-secondary bg-primary p-3 lg:block">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </aside>
        <main className="flex flex-col items-center gap-4 bg-secondary_alt p-6">
          <div className="flex max-w-full gap-2.5">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="aspect-[9/16] w-[74px] shrink-0" />
            ))}
          </div>
          <Skeleton className="h-[min(52vh,440px)] aspect-[9/16]" />
        </main>
        <aside className="space-y-3 bg-primary p-6">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </aside>
      </div>
    </div>
  );
}

export function AccountSkeleton() {
  return (
    <>
      <PageHeaderSkeleton />
      <Body className="max-w-xl">
        <div className="rounded-xl border border-secondary bg-primary p-6">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="mt-3 h-5 w-2/3" />
          <Skeleton className="mt-6 h-10 w-28" />
        </div>
      </Body>
    </>
  );
}

export function CardListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className="h-32 w-full" />
      ))}
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Body>
      <div className="ds-empty">
        <p className="text-sm font-semibold">Could not load this page</p>
        <p className="mt-1 text-sm text-tertiary">{message}</p>
        <Button color="primary" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </Body>
  );
}
