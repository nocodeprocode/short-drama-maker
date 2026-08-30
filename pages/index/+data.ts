import { checkSupabaseConnection } from "../../lib/supabase";

export { data };
export type Data = Awaited<ReturnType<typeof data>>;

async function data() {
  const supabase = await checkSupabaseConnection();
  return { supabase };
}
