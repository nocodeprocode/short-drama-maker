/**
 * Wipe studio data for the staging demo login so the full product loop
 * can be walked again. Keeps the auth user and admin role.
 *
 *   npx tsx scripts/reset-demo-account.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();

const EMAIL = (process.env.DEMO_EMAIL ?? "staging-admin@shortdramamaker.app").trim().toLowerCase();
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: listed, error: listError } = await supabase.auth.admin.listUsers({ perPage: 200 });
if (listError) throw listError;
const user = listed.users.find((row) => row.email?.toLowerCase() === EMAIL);
if (!user) throw new Error(`No auth user for ${EMAIL}`);

const owner = user.id;

async function count(table: string, column = "owner_id") {
  const { count: value, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq(column, owner);
  if (error) throw error;
  return value ?? 0;
}

async function del(table: string, column = "owner_id") {
  const { error } = await supabase.from(table).delete().eq(column, owner);
  if (error) throw error;
}

const before = {
  series: await count("series"),
  productions: await count("productions"),
  actors: await count("actors"),
  assets: await count("assets"),
  tasks: await count("engine_tasks"),
  jobs: await count("generation_jobs"),
  ledger: await count("project_ledger"),
};

const { data: seriesRows, error: seriesError } = await supabase.from("series").select("id").eq("owner_id", owner);
if (seriesError) throw seriesError;
const seriesIds = (seriesRows ?? []).map((row) => row.id);

const { error: coverError } = await supabase.from("series").update({ cover_asset_id: null }).eq("owner_id", owner);
if (coverError) throw coverError;

if (seriesIds.length) {
  const { error } = await supabase.from("characters").update({ actor_id: null }).in("series_id", seriesIds);
  if (error) throw error;
  const { error: modError } = await supabase.from("moderation_decisions").delete().in("series_id", seriesIds);
  if (modError) throw modError;
}

const { error: seedError } = await supabase.from("actors").update({ seed_asset_id: null }).eq("owner_id", owner);
if (seedError) throw seedError;
const { error: assetActorError } = await supabase.from("assets").update({ actor_id: null }).eq("owner_id", owner);
if (assetActorError) throw assetActorError;

await del("job_events");
await del("engine_tasks");
await del("productions");
await del("project_ledger");
await del("generation_jobs");
await del("actors");
await del("assets");
await del("series");
await del("legal_acceptances", "user_id");
await del("privacy_requests", "user_id");

const { error: profileError } = await supabase
  .from("profiles")
  .update({ stripe_customer_id: null, updated_at: new Date().toISOString() })
  .eq("id", owner);
if (profileError) throw profileError;

const after = {
  series: await count("series"),
  productions: await count("productions"),
  actors: await count("actors"),
  assets: await count("assets"),
  tasks: await count("engine_tasks"),
  jobs: await count("generation_jobs"),
  ledger: await count("project_ledger"),
};

console.log(
  JSON.stringify(
    {
      email: EMAIL,
      kept_login: true,
      before,
      after,
    },
    null,
    2,
  ),
);
