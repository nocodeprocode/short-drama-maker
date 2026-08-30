import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function getSupabaseUrl(): string | undefined {
  return import.meta.env.VITE_SUPABASE_URL;
}

export function getSupabasePublishableKey(): string | undefined {
  return import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
}

export function createSupabaseClient(): SupabaseClient {
  const url = getSupabaseUrl();
  const publishableKey = getSupabasePublishableKey();

  if (!url || !publishableKey) {
    throw new Error(
      "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY",
    );
  }

  return createClient(url, publishableKey);
}

export type SupabaseConnection = {
  ok: boolean;
  message: string;
};

export async function checkSupabaseConnection(): Promise<SupabaseConnection> {
  const url = getSupabaseUrl();
  const publishableKey = getSupabasePublishableKey();

  if (!url || !publishableKey) {
    return {
      ok: false,
      message: "Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY",
    };
  }

  try {
    createSupabaseClient();

    const response = await fetch(new URL("/auth/v1/health", url), {
      headers: { apikey: publishableKey },
    });

    if (!response.ok) {
      return {
        ok: false,
        message: `Auth health returned HTTP ${response.status}`,
      };
    }

    return {
      ok: true,
      message: "Reachable from SSR",
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Unreachable",
    };
  }
}
