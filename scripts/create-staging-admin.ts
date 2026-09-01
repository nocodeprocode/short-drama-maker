import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();

const email = process.env.ADMIN_EMAIL?.trim() ?? "staging-admin@shortdramamaker.app";
const password = process.env.ADMIN_PASSWORD?.trim();
if (!password) {
  throw new Error("ADMIN_PASSWORD is required for create-staging-admin.");
}

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishable = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !service || !publishable) {
  throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and VITE_SUPABASE_PUBLISHABLE_KEY are required.");
}

const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: listed, error: listError } = await admin.auth.admin.listUsers();
if (listError) throw listError;

const existing = listed.users.find((row) => row.email?.toLowerCase() === email.toLowerCase());
let userId: string;

if (existing) {
  const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
    app_metadata: { ...(existing.app_metadata ?? {}), role: "admin" },
  });
  if (error) throw error;
  userId = data.user.id;
  console.log(`Updated existing admin ${email} (${userId})`);
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: "admin" },
  });
  if (error) throw error;
  userId = data.user.id;
  console.log(`Created admin ${email} (${userId})`);
}

const browser = createClient(url, publishable, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: session, error: signInError } = await browser.auth.signInWithPassword({
  email,
  password,
});
if (signInError) throw signInError;

console.log(
  `Sign-in ok role=${String(session.user.app_metadata.role)} token=${Boolean(session.session?.access_token)}`,
);
