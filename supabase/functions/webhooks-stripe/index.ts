import { json, serviceClient } from "../_shared/auth.ts";
import { wakeJobs } from "../_shared/jobs.ts";
import { PRICE_SNAPSHOT_VERSION } from "../_shared/productions.ts";
import { seriesReadiness } from "../_shared/readiness.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) return json({ error: "Webhook secret not configured" }, 500);

  const signature = req.headers.get("stripe-signature");
  if (!signature) return json({ error: "Missing stripe-signature" }, 401);

  const raw = await req.text();
  const valid = await verifyStripeSignature(raw, signature, secret);
  if (!valid) return json({ error: "Invalid Stripe signature" }, 401);

  const event = JSON.parse(raw) as {
    id: string;
    type: string;
    data: {
      object: {
        id?: string;
        payment_status?: string;
        client_reference_id?: string;
        customer?: string | null;
        metadata?: Record<string, string>;
        amount_total?: number;
        amount_refunded?: number;
        refunds?: { data?: Array<{ amount?: number }> };
        payment_intent?: string | { metadata?: Record<string, string> };
      };
    };
  };

  const supabase = serviceClient();

  if (event.type === "charge.refunded" || event.type === "refund.created") {
    const charge = event.data.object;
    const seriesId = charge.metadata?.series_id;
    const ownerId = charge.metadata?.owner_id;
    const latestRefund = charge.refunds?.data?.[0]?.amount;
    const amount = (latestRefund ?? charge.amount_refunded ?? 0) / 100;
    if (!ownerId) {
      return json({ error: "Missing owner metadata on refund" }, 400);
    }
    if (!seriesId) {
      const unused = await unusedWallet(supabase, ownerId);
      const debit = Math.min(Math.max(amount, 0), Math.max(unused, 0));
      if (debit <= 0) return json({ ok: true, ignored: true, reason: "no_unused_budget" });
      const { error } = await supabase.from("project_ledger").insert({
        owner_id: ownerId,
        series_id: null,
        entry_type: "adjustment",
        amount: -debit,
        stripe_event_id: event.id,
        price_snapshot_version: PRICE_SNAPSHOT_VERSION,
      });
      if (error?.code === "23505") return json({ ok: true, duplicate: true });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, event_id: event.id, debit, wallet: true });
    }
    const unused = await unusedBalance(supabase, seriesId);
    const debit = Math.min(Math.max(amount, 0), Math.max(unused, 0));
    if (debit <= 0) return json({ ok: true, ignored: true, reason: "no_unused_budget" });
    const { error } = await supabase.from("project_ledger").insert({
      owner_id: ownerId,
      series_id: seriesId,
      entry_type: "adjustment",
      amount: -debit,
      stripe_event_id: event.id,
      price_snapshot_version: PRICE_SNAPSHOT_VERSION,
    });
    if (error?.code === "23505") return json({ ok: true, duplicate: true });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, event_id: event.id, debit });
  }

  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return json({ ignored: true });
  }

  const session = event.data.object;
  if (session.payment_status === "unpaid") {
    return json({ ignored: true, reason: "unpaid" });
  }

  const seriesId = session.metadata?.series_id || null;
  const productionId = session.metadata?.production_id ?? (seriesId ? session.client_reference_id : undefined);
  const ownerId = session.metadata?.owner_id;
  const sku = session.metadata?.sku;
  const amount = (session.amount_total ?? 0) / 100;
  if (!ownerId) {
    return json({ error: "Missing owner metadata" }, 400);
  }
  const wallet = !seriesId && (sku === "credit" || sku === "topup");
  if (!seriesId && !wallet) {
    return json({ error: "Missing series or owner metadata" }, 400);
  }

  if (session.customer && typeof session.customer === "string") {
    await supabase
      .from("profiles")
      .update({ stripe_customer_id: session.customer, updated_at: new Date().toISOString() })
      .eq("id", ownerId)
      .is("stripe_customer_id", null);
  }

  const { error } = await supabase.from("project_ledger").insert({
    owner_id: ownerId,
    series_id: wallet ? null : seriesId,
    entry_type: "purchase",
    amount,
    stripe_event_id: event.id,
    price_snapshot_version: PRICE_SNAPSHOT_VERSION,
  });

  const duplicate = error?.code === "23505";
  if (error && !duplicate) return json({ error: error.message }, 400);
  if (wallet && duplicate) return json({ ok: true, duplicate: true });

  if (!wallet && seriesId && productionId) {
    const { data: production } = await supabase
      .from("productions")
      .select("id, owner_id, series_id, status")
      .eq("id", productionId)
      .eq("owner_id", ownerId)
      .eq("series_id", seriesId)
      .eq("status", "awaiting_payment")
      .maybeSingle();
    if (!production) {
      return json({ ok: true, event_id: event.id, production_id: null, started: false, duplicate, reason: "production_not_found" });
    }

    const [{ data: series }, readiness] = await Promise.all([
      supabase.from("series").select("story_bible").eq("id", seriesId).maybeSingle(),
      seriesReadiness(supabase, seriesId),
    ]);
    const blocking = series?.story_bible ? readiness.blocking : ["The story has not been written yet", ...readiness.blocking];
    if (!series?.story_bible || !readiness.can_start) {
      await supabase
        .from("productions")
        .update({
          status: "needs_user",
          ui_phase: "preparing",
          paid_amount: amount,
          stripe_checkout_id: session.id ?? null,
          paused: true,
          intervention_type: "missing_dependencies",
          intervention: { readiness: { ...readiness, can_start: false, blocking } },
          agent_decision: `Payment is safe as show credit. Restore required material before production starts. ${blocking.join(". ")}.`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", production.id);
      return json({ ok: true, event_id: event.id, production_id: production.id, started: false, duplicate, reason: "not_ready" });
    }

    const { data: activated } = await supabase
      .from("productions")
      .update({
        status: "queued",
        ui_phase: "preparing",
        paid_amount: amount,
        stripe_checkout_id: session.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", production.id)
      .eq("status", "awaiting_payment")
      .select("id")
      .maybeSingle();
    if (!activated) {
      return json({ ok: true, event_id: event.id, production_id: production.id, started: false, duplicate, reason: "not_activated" });
    }
    await supabase.from("engine_tasks").insert({
      owner_id: ownerId,
      series_id: seriesId,
      production_id: production.id,
      action: "advance_production",
      payload: { production_id: production.id },
      status: "queued",
    });
    await wakeJobs();
  }

  return json({ ok: true, event_id: event.id, production_id: productionId ?? null, started: Boolean(!wallet && seriesId && productionId), duplicate });
});

function ledgerBalance(rows: Array<{ entry_type: string; amount: number | string }>): number {
  return rows.reduce((sum, row) => {
    const amount = Number(row.amount);
    if (row.entry_type === "purchase" || row.entry_type === "release" || row.entry_type === "adjustment") {
      return sum + amount;
    }
    if (row.entry_type === "reserve" || row.entry_type === "settle") return sum - amount;
    return sum;
  }, 0);
}

async function unusedBalance(
  supabase: ReturnType<typeof serviceClient>,
  seriesId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("project_ledger")
    .select("entry_type, amount")
    .eq("series_id", seriesId);
  if (error) throw new Error(error.message);
  return ledgerBalance(data ?? []);
}

async function unusedWallet(
  supabase: ReturnType<typeof serviceClient>,
  ownerId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("project_ledger")
    .select("entry_type, amount")
    .eq("owner_id", ownerId)
    .is("series_id", null);
  if (error) throw new Error(error.message);
  return ledgerBalance(data ?? []);
}

async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string,
): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(",").map((item) => {
      const [key, ...rest] = item.split("=");
      return [key, rest.join("=")];
    }),
  );
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const signed = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed));
  const digest = [...new Uint8Array(mac)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return timingSafeEqual(digest, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
