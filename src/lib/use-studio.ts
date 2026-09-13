import { useEffect, useRef, useState } from "react";
import { readCache, writeCache } from "./cache.ts";
import { currentSession, getAccessToken, refreshSession, supabaseBrowser } from "./session.ts";

const LIVE_TABLES = [
  "productions",
  "engine_tasks",
  "assets",
  "characters",
  "episodes",
  "shots",
  "series",
  "actors",
  "series_cast",
  "series_locations",
  "series_props",
  "locations",
  "props",
] as const;

export function useSessionReady() {
  const [ready, setReady] = useState(() => Boolean(getAccessToken()));
  useEffect(() => {
    if (getAccessToken()) setReady(true);
    currentSession().then((session) => {
      if (session?.access_token || getAccessToken()) {
        setReady(true);
        return;
      }
      window.location.href = "/login";
    });
  }, []);
  return ready;
}

export function useStudio<T>(key: string, loader: () => Promise<T>, deps: unknown[] = []) {
  const ready = useSessionReady();
  const [data, setData] = useState<T | null>(() => readCache<T>(key));
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  const keyRef = useRef(key);
  loaderRef.current = loader;

  if (keyRef.current !== key) {
    keyRef.current = key;
    setData(readCache<T>(key));
    setError(null);
  }

  const reload = () =>
    loaderRef
      .current()
      .then((value) => {
        setData(value);
        writeCache(keyRef.current, value);
        setError(null);
        return value;
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Could not load");
      });

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    loaderRef
      .current()
      .then((value) => {
        if (!cancelled) {
          setData(value);
          writeCache(key, value);
          setError(null);
        }
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load");
      });
    return () => {
      cancelled = true;
    };
  }, [ready, key, ...deps]);

  useLiveReload(() => void reload(), [key, ...deps], ready);

  return {
    data,
    error,
    ready,
    loading: ready && data == null && !error,
    reload,
  };
}

export function useLiveReload(onChange: () => void, deps: unknown[] = [], enabled = true) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;

    let debounce = 0;
    let wasHidden = document.visibilityState === "hidden";
    let channel: ReturnType<ReturnType<typeof supabaseBrowser>["channel"]> | null = null;
    let cancelled = false;

    const refresh = () => {
      onChangeRef.current();
    };

    const scheduleFromRealtime = () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
        return;
      }
      if (debounce) return;
      debounce = window.setTimeout(() => {
        debounce = 0;
        refresh();
      }, 800);
    };

    const resumeIfReturned = () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
        return;
      }
      if (!wasHidden) return;
      wasHidden = false;
      void refreshSession().then((session) => {
        const token = session?.access_token ?? getAccessToken();
        if (token) void supabaseBrowser().realtime.setAuth(token);
        refresh();
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
        return;
      }
      resumeIfReturned();
    };

    void currentSession().then((session) => {
      if (cancelled) return;
      const token = session?.access_token ?? getAccessToken();
      if (!token) return;
      const client = supabaseBrowser();
      void client.realtime.setAuth(token);
      let next = client.channel(`studio-live:${deps.join(":") || "app"}`);
      for (const table of LIVE_TABLES) {
        next = next.on("postgres_changes", { event: "*", schema: "public", table }, scheduleFromRealtime);
      }
      channel = next.subscribe();
    });

    const onPageShow = (event: Event) => {
      if ("persisted" in event && (event as PageTransitionEvent).persisted) {
        wasHidden = true;
      }
      resumeIfReturned();
    };

    window.addEventListener("focus", resumeIfReturned);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (debounce) window.clearTimeout(debounce);
      window.removeEventListener("focus", resumeIfReturned);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
      if (channel) void supabaseBrowser().removeChannel(channel);
    };
  }, [enabled, ...deps]);
}
