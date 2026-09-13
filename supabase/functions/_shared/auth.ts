import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { accessFromAppMetadata, DOCUMENT_VERSIONS } from "./access.ts";

export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser(req: Request) {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    throw json({ error: "Unauthorized" }, 401);
  }
  const supabase = serviceClient();
  const token = auth.slice("Bearer ".length);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw json({ error: "Unauthorized" }, 401);
  }
  return { supabase, user: data.user };
}

export async function requireAccess(req: Request) {
  const { supabase, user } = await requireUser(req);
  const access = accessFromAppMetadata(user.app_metadata as Record<string, unknown>);
  if (!access.allowed) {
    throw json({ error: "beta_or_admin_required" }, 403);
  }

  const path = new URL(req.url).pathname.replace(/^\/api/, "") || "/";
  const hydrateSession = req.method !== "GET" || path === "/me" || path === "/account" || path === "/home";
  if (hydrateSession) {
    const { error: profileError } = await supabase.from("profiles").upsert({
      id: user.id,
      updated_at: new Date().toISOString(),
    });
    if (profileError) {
      throw json({ error: profileError.message }, 500);
    }

    const { data: existing, error: legalError } = await supabase
      .from("legal_acceptances")
      .select("document_type")
      .eq("user_id", user.id);
    if (legalError) {
      throw json({ error: legalError.message }, 500);
    }
    const have = new Set((existing ?? []).map((row) => row.document_type));
    const missing = Object.entries(DOCUMENT_VERSIONS)
      .filter(([type]) => !have.has(type))
      .map(([document_type, version]) => ({
        user_id: user.id,
        document_type,
        version,
        context: "first_login",
        user_agent_summary: req.headers.get("user-agent")?.slice(0, 180) ?? null,
      }));
    if (missing.length > 0) {
      const { error: insertError } = await supabase.from("legal_acceptances").insert(missing);
      if (insertError) {
        throw json({ error: insertError.message }, 500);
      }
    }
  }

  return { supabase, user, access };
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type, apikey",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    },
  });
}
