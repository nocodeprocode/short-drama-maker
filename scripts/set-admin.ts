import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./load-env.ts";

loadLocalEnv();

const email = process.env.ADMIN_EMAIL?.trim();
if (!email) {
  throw new Error("ADMIN_EMAIL is required. Set it to the operator account you already created.");
}

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase.auth.admin.listUsers();
if (error) throw error;

const user = data.users.find((row) => row.email?.toLowerCase() === email.toLowerCase());
if (!user) {
  throw new Error(`No auth user with email ${email}. Create the account first, then rerun.`);
}

const appMetadata = {
  ...(user.app_metadata ?? {}),
  role: "admin",
};
const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
  app_metadata: appMetadata,
});
if (updateError) throw updateError;

console.log(`Set app_metadata.role=admin for ${email} (${user.id})`);
