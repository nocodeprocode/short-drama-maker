import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { clearCache } from "./cache.ts";

const TOKEN_KEY = "ds.access_token";

let browserClient: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (browserClient) return browserClient;
  browserClient = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
  );
  return browserClient;
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(TOKEN_KEY);
  if (stored) return stored;
  for (const key of Object.keys(window.localStorage)) {
    if (!key.includes("auth-token")) continue;
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) ?? "") as {
        access_token?: string;
        currentSession?: { access_token?: string };
      };
      return parsed.access_token ?? parsed.currentSession?.access_token ?? null;
    } catch {
      /* ignore malformed persist payloads */
    }
  }
  return null;
}

export function rememberSession(session: Session | null) {
  if (typeof window === "undefined") return;
  if (session?.access_token) {
    window.localStorage.setItem(TOKEN_KEY, session.access_token);
    document.cookie = `ds-access-token=${session.access_token}; Path=/; SameSite=Lax; Max-Age=604800`;
  } else {
    window.localStorage.removeItem(TOKEN_KEY);
    document.cookie = "ds-access-token=; Path=/; Max-Age=0";
  }
}

export async function currentSession(): Promise<Session | null> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (data.session) {
    rememberSession(data.session);
    return data.session;
  }
  return null;
}

export async function refreshSession(): Promise<Session | null> {
  const { data } = await supabaseBrowser().auth.refreshSession();
  if (data.session) {
    rememberSession(data.session);
    return data.session;
  }
  return currentSession();
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabaseBrowser().auth.signInWithPassword({ email, password });
  if (error) throw error;
  rememberSession(data.session);
  return data.session;
}

export async function signUp(email: string, password: string) {
  const { data, error } = await supabaseBrowser().auth.signUp({ email, password });
  if (error) throw error;
  if (data.session) rememberSession(data.session);
  return data;
}

export async function requestPasswordReset(email: string) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const { error } = await supabaseBrowser().auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/login?mode=update`,
  });
  if (error) throw error;
}

export async function updatePassword(password: string) {
  const { data, error } = await supabaseBrowser().auth.updateUser({ password });
  if (error) throw error;
  if (data.user) {
    const session = await currentSession();
    return session;
  }
  return currentSession();
}

export async function signOut() {
  await supabaseBrowser().auth.signOut();
  rememberSession(null);
  clearCache();
}
