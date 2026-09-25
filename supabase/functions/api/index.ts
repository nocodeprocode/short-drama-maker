import { DOCUMENT_VERSIONS } from "../_shared/access.ts";
import { castAppearance, fillAppearance, inferGenderFromText } from "../../../src/drama-engine/craft/appearance.ts";
import { json, requireAccess, serviceClient } from "../_shared/auth.ts";
import { requireTurnstile } from "../_shared/turnstile.ts";
import { moderateText } from "../_shared/moderation.ts";
import {
  allocateWalletToSeries,
  createProductionRecord,
  enqueue,
  ownedSeries,
  parseProductionBody,
  PRICE_SNAPSHOT_VERSION,
  publicCharacter,
  publicProduction,
  seriesBalance,
  seriesSpent,
  seriesPoster,
  walletBalance,
  type ProductionRow,
} from "../_shared/productions.ts";
import { hasExplicitStartConfirmation } from "../_shared/production-consent.ts";
import { generateStoryIdea, STORY_DIRECTIONS, type StoryIdeaInput } from "../_shared/story-idea.ts";
import { adaptUploadedScript } from "../_shared/story-script.ts";
import { actorGenerateTasks, actorHostSeriesId, actorShowTitles, firstOwnedSeriesId, presentActor, signActorPacks } from "../_shared/actors.ts";
import { ensureCastSlate } from "../_shared/cast-repair.ts";
import {
  decodeLibraryImage,
  libraryShowTitles,
  normalizeLibraryName,
  presentLocationEntry,
  presentPropEntry,
  putLibraryImage,
  signLibraryImages,
  signLibraryLocationAngles,
  useLocationEntry,
  usePropEntry,
  type LocationEntry,
  type PropEntry,
} from "../_shared/library.ts";
import { seriesReadiness } from "../_shared/readiness.ts";
import {
  ensureDesignSlate,
  normalizeDesignName,
  presentLocation,
  presentProp,
  signDesignAssets,
  type LocationRow,
  type PropRow,
} from "../_shared/design.ts";
import { propKindFor } from "../_shared/design-slate.ts";
import { decodeSeedPhoto, latestSeedAssetId, putSeedAsset, recoverSeedFromTasks } from "../_shared/seed-asset.ts";
import { buildCastSlate } from "../_shared/slate.ts";
import {
  bindCastPlan,
  castActorOnCharacter,
  generateMissingFaces,
  normalizeRoleName,
  normalizeTags,
  presentCastSlot,
  type CastSlotRow,
} from "../_shared/casting.ts";
import { presentPackedCharacter, signCharacterPacks } from "../_shared/characters.ts";
import {
  LEGAL_ACCEPTANCE_CONFLICT,
  acceptanceWriteError,
  likenessAcceptanceRow,
  likenessGate,
} from "../_shared/likeness.ts";
import { discardUnpaidSeries } from "../_shared/drafts.ts";
import { actionLabel, activityDetail, attentionKind, interventionMessage, seriesNextAction, sortShotVideoRows, stillAssetIds, usd } from "../_shared/present.ts";
import { wakeJobs } from "../_shared/jobs.ts";
import { signAssetRows } from "../_shared/sign.ts";
import {
  CREDIT_PRESETS,
  estimateBlock,
  isBlockSku,
  isCatalogSku,
  isEpisodeLength,
  isPriority,
  isSeasonSku,
  isVideoTier,
  posterTone,
  retailForBlock,
  SEASON_PRICES_USD,
  type BlockSku,
  type EpisodeLength,
  type ProductionPriority,
} from "../_shared/skus.ts";

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "authorization, content-type, apikey",
          "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        },
      });
    }

    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, "") || "/";

    if (req.method === "GET" && path === "/health") {
      return json({ ok: true, phase: "drama-space", product: "Takehaus" });
    }

    if (req.method === "POST" && path === "/privacy/requests") {
      return createPrivacyRequest(req);
    }

    if (req.method === "POST" && path === "/moderation/check") {
      const body = await req.json().catch(() => ({}));
      const verdict = moderateText(String(body.text ?? ""), "story_input");
      return json({
        allowed: verdict.verdict === "allow",
        verdict: verdict.verdict,
        reason: verdict.verdict === "allow" ? null : verdict.reason,
      });
    }

    if (req.method === "POST" && path === "/auth/signup") {
      return createSignup(req);
    }
    if (req.method === "POST" && path === "/auth/recover") {
      return createRecover(req);
    }

    const { supabase, user, access } = await requireAccess(req);

    if (req.method === "GET" && path === "/story-ideas/directions") {
      return json({ items: STORY_DIRECTIONS });
    }

    if (req.method === "POST" && path === "/story-ideas/stream") {
      const body = await req.json().catch(() => ({}));
      const generationId = String(body.generation_id ?? "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(generationId)) {
        return json({ error: "A valid generation_id is required" }, 400);
      }
      const input = storyIdeaInput(body);
      const { data: existing } = await supabase
        .from("story_generations")
        .select("id")
        .eq("id", generationId)
        .eq("owner_id", user.id)
        .maybeSingle();
      if (!existing) {
        const { error } = await supabase.from("story_generations").insert({
          id: generationId,
          owner_id: user.id,
          status: "queued",
          input,
        });
        if (error) return json({ error: error.code === "23505" ? "generation_id_conflict" : error.message }, error.code === "23505" ? 409 : 400);
      }
      launchStoryGeneration(supabase, user.id, generationId);
      return streamStoryGeneration(req, supabase, user.id, generationId);
    }

    if (req.method === "GET" && /^\/story-ideas\/[0-9a-f-]+\/stream$/i.test(path)) {
      const generationId = path.split("/")[2] ?? "";
      const { data: generation } = await supabase
        .from("story_generations")
        .select("id, status, updated_at")
        .eq("id", generationId)
        .eq("owner_id", user.id)
        .maybeSingle();
      if (!generation) return json({ error: "Story generation not found" }, 404);
      const stale = generation.status === "running" &&
        Date.parse(String(generation.updated_at)) < Date.now() - 90_000;
      if (stale) {
        await supabase
          .from("story_generations")
          .update({ status: "queued", error: null, updated_at: new Date().toISOString() })
          .eq("id", generationId)
          .eq("owner_id", user.id)
          .eq("status", "running");
      }
      if (generation.status === "queued" || stale) launchStoryGeneration(supabase, user.id, generationId);
      return streamStoryGeneration(req, supabase, user.id, generationId);
    }

    if (req.method === "POST" && path === "/story-ideas") {
      const body = await req.json().catch(() => ({}));
      try {
        const idea = await generateStoryIdea(storyIdeaInput(body));
        return json(idea);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not write a brief";
        const policy = error instanceof Error && error.name === "PolicyError";
        return json({ error: message, reason: message }, policy ? 422 : 502);
      }
    }

    if (req.method === "POST" && path === "/story-scripts") {
      const body = await req.json().catch(() => ({}));
      try {
        return json(await adaptUploadedScript(String(body.text ?? "")));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not adapt the script";
        const name = error instanceof Error ? error.name : "";
        const status = name === "PolicyError" ? 422 : name === "InputError" ? 400 : 502;
        return json({ error: message, reason: message }, status);
      }
    }

    if (req.method === "GET" && path === "/me") {
      const [{ data: profile }, { data: accepted }] = await Promise.all([
        supabase.from("profiles").select("id, stripe_customer_id").eq("id", user.id).maybeSingle(),
        supabase
          .from("legal_acceptances")
          .select("accepted_at")
          .eq("user_id", user.id)
          .order("accepted_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return json({
        id: user.id,
        email: user.email,
        display_name: displayName(user.email),
        role: access.role,
        beta: access.beta,
        is_admin: access.isAdmin,
        stripe_customer_id: profile?.stripe_customer_id ?? null,
        accepted_at: accepted?.accepted_at ?? null,
      });
    }

    if (req.method === "POST" && path === "/me/accept") {
      return recordAcceptances(supabase, user.id, req, "accepted");
    }

    if (req.method === "GET" && path === "/account") {
      const { count } = await supabase
        .from("productions")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", user.id)
        .in("status", ["queued", "running", "needs_user"]);
      return json({
        id: user.id,
        email: user.email,
        display_name: displayName(user.email),
        is_admin: access.isAdmin,
        slots_used: count ?? 0,
        slots_total: 4,
        credit_balance: await walletBalance(supabase, user.id),
      });
    }

    if (req.method === "GET" && path === "/actors") {
      const { data, error } = await supabase.from("actors").select("*").eq("owner_id", user.id).order("created_at");
      if (error) return json({ error: error.message }, 400);
      const signed = await signActorPacks(supabase, data ?? []);
      const ids = (data ?? []).map((row) => String(row.id));
      const shows = await actorShowTitles(supabase, ids);
      const tasks = await actorGenerateTasks(supabase, user.id, ids);
      const tags = [
        ...new Set((data ?? []).flatMap((row) => (Array.isArray(row.tags) ? (row.tags as string[]) : []))),
      ].sort((left, right) => left.localeCompare(right));
      return json({
        items: (data ?? []).map((row) =>
          presentActor(row, signed, { shows: shows.get(String(row.id)) ?? [], task: tasks.get(String(row.id)) ?? null }),
        ),
        tags,
      });
    }

    if (req.method === "PATCH" && /^\/actors\/[^/]+$/.test(path)) {
      const id = path.split("/")[2];
      const body = await req.json().catch(() => ({}));
      const { data: actor } = await supabase
        .from("actors")
        .select("*")
        .eq("id", id)
        .eq("owner_id", user.id)
        .maybeSingle();
      if (!actor) return json({ error: "Not found" }, 404);
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.name === "string") {
        const name = body.name.trim().slice(0, 80);
        if (!name) return json({ error: "Name is required" }, 400);
        const verdict = moderateText(name, "character_create");
        if (verdict.verdict === "block") return json({ error: verdict.reason, reason: verdict.reason }, 422);
        patch.name = name;
      }
      if (body.tags !== undefined) patch.tags = normalizeTags(body.tags);
      if (typeof body.notes === "string") patch.notes = body.notes.trim().slice(0, 600);
      if (body.identity_fidelity === "faithful" || body.identity_fidelity === "idealized") {
        patch.identity_fidelity = body.identity_fidelity;
      }
      if (typeof body.description === "string" || typeof body.default_wardrobe === "string") {
        const profile = (actor.appearance_profile ?? {}) as Record<string, unknown>;
        patch.appearance_profile = {
          ...profile,
          description: typeof body.description === "string" ? body.description.trim().slice(0, 600) : profile.description,
          default_wardrobe:
            typeof body.default_wardrobe === "string"
              ? body.default_wardrobe.trim().slice(0, 240)
              : profile.default_wardrobe,
        };
        if (typeof body.description === "string" && body.notes === undefined) {
          patch.notes = body.description.trim().slice(0, 600);
        }
      }
      const { data: saved, error } = await supabase
        .from("actors")
        .update(patch)
        .eq("id", id)
        .eq("owner_id", user.id)
        .select("*")
        .single();
      if (error || !saved) return json({ error: error?.message ?? "Could not save" }, 400);
      const signed = await signActorPacks(supabase, [saved]);
      const shows = await actorShowTitles(supabase, [String(saved.id)]);
      const tasks = await actorGenerateTasks(supabase, user.id, [String(saved.id)]);
      return json(presentActor(saved, signed, { shows: shows.get(String(saved.id)) ?? [], task: tasks.get(String(saved.id)) ?? null }));
    }

    if (req.method === "DELETE" && /^\/actors\/[^/]+$/.test(path)) {
      const id = path.split("/")[2];
      const { data: actor } = await supabase
        .from("actors")
        .select("id")
        .eq("id", id)
        .eq("owner_id", user.id)
        .maybeSingle();
      if (!actor) return json({ error: "Not found" }, 404);
      // A face that already shot cannot be removed: takes in the can reference
      // it, so deleting it would strand their identity.
      const { data: locked } = await supabase
        .from("characters")
        .select("id")
        .eq("actor_id", id)
        .eq("locked", true)
        .limit(1);
      if ((locked ?? []).length > 0) {
        return json({ error: "This actor is locked into a show that already shot." }, 409);
      }
      const { error } = await supabase.from("actors").delete().eq("id", id).eq("owner_id", user.id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, deleted: id });
    }

    if (req.method === "POST" && /^\/actors\/[^/]+\/regenerate$/.test(path)) {
      const id = path.split("/")[2];
      const { data: actor } = await supabase.from("actors").select("*").eq("id", id).eq("owner_id", user.id).maybeSingle();
      if (!actor) return json({ error: "Not found" }, 404);
      const { data: locked } = await supabase.from("characters").select("id").eq("actor_id", id).eq("locked", true).limit(1);
      if ((locked ?? []).length > 0) {
        return json({ error: "This actor is locked into a show that already shot." }, 409);
      }
      const body = await req.json().catch(() => ({}));
      const kinds = Array.isArray(body.kinds) ? (body.kinds as unknown[]).map((item) => String(item)) : [];
      const refs = { ...((actor.visual_reference_asset_ids ?? {}) as Record<string, unknown>) };
      if (kinds.length) for (const kind of kinds) delete refs[kind];
      else for (const key of Object.keys(refs)) delete refs[key];
      const { data: saved, error } = await supabase
        .from("actors")
        .update({ visual_reference_asset_ids: refs, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("owner_id", user.id)
        .select("*")
        .single();
      if (error || !saved) return json({ error: error?.message ?? "Could not regenerate" }, 400);
      const asked =
        typeof body.series_id === "string" && body.series_id
          ? await ownedSeries(supabase, user.id, body.series_id, access.isAdmin)
          : null;
      const host =
        asked?.id ??
        (await actorHostSeriesId(
          supabase,
          user.id,
          id,
          await firstOwnedSeriesId(supabase, user.id, access.isAdmin),
        ));
      let seedAssetId = saved.seed_asset_id ? String(saved.seed_asset_id) : null;
      const latestSeed = await latestSeedAssetId(supabase, { ownerId: user.id, actorId: id });
      if (latestSeed && latestSeed !== seedAssetId) seedAssetId = latestSeed;
      if (!seedAssetId) {
        seedAssetId = await recoverSeedFromTasks(supabase, { ownerId: user.id, actorId: id, seriesId: host });
      }
      if (seedAssetId && seedAssetId !== saved.seed_asset_id) {
        const { error: seedError } = await supabase
          .from("actors")
          .update({ seed_asset_id: seedAssetId, source: "likeness", updated_at: new Date().toISOString() })
          .eq("id", id);
        if (seedError) return json({ error: seedError.message }, 400);
        saved.seed_asset_id = seedAssetId;
      }
      if (host) {
        await enqueue(supabase, user.id, host, "generate_actor", {
          actor_id: id,
          seed_asset_id: seedAssetId ?? undefined,
        }, access.isAdmin);
      }
      const signed = await signActorPacks(supabase, [saved]);
      const shows = await actorShowTitles(supabase, [id]);
      const tasks = await actorGenerateTasks(supabase, user.id, [id]);
      return json(presentActor(saved, signed, { shows: shows.get(id) ?? [], task: tasks.get(id) ?? null }), 202);
    }

    if (req.method === "POST" && /^\/actors\/[^/]+\/photo$/.test(path)) {
      const id = path.split("/")[2];
      const { data: actor } = await supabase.from("actors").select("*").eq("id", id).eq("owner_id", user.id).maybeSingle();
      if (!actor) return json({ error: "Not found" }, 404);
      const { data: locked } = await supabase.from("characters").select("id").eq("actor_id", id).eq("locked", true).limit(1);
      if ((locked ?? []).length > 0) {
        return json({ error: "This actor is locked into a show that already shot." }, 409);
      }
      const body = await req.json().catch(() => ({}));
      const seed = typeof body.seed_base64 === "string" && body.seed_base64 ? String(body.seed_base64) : "";
      if (!seed) return json({ error: "A photo is required" }, 400);
      const gate = likenessGate(body.likeness_confirmed === true);
      if (!gate.ok) return json({ error: gate.error }, gate.status);
      const photo = decodeSeedPhoto(seed, body.seed_mime_type);
      const asked =
        typeof body.series_id === "string" && body.series_id
          ? await ownedSeries(supabase, user.id, body.series_id, access.isAdmin)
          : null;
      const host =
        asked?.id ??
        (await actorHostSeriesId(
          supabase,
          user.id,
          id,
          await firstOwnedSeriesId(supabase, user.id, access.isAdmin),
        ));
      const stored = await putSeedAsset(supabase, {
        ownerId: user.id,
        actorId: id,
        seriesId: host,
        bytes: photo.bytes,
        mime: photo.mime,
      });
      // Same user + same likeness version already has a row from the first photo.
      const { error: acceptError } = await supabase.from("legal_acceptances").insert(likenessAcceptanceRow(user.id));
      const acceptProblem = acceptanceWriteError(acceptError?.message);
      if (acceptProblem) return json({ error: acceptProblem }, 400);
      const { data: saved, error } = await supabase
        .from("actors")
        .update({
          seed_asset_id: stored.id,
          source: "likeness",
          visual_reference_asset_ids: {},
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("owner_id", user.id)
        .select("*")
        .single();
      if (error || !saved) return json({ error: error?.message ?? "Could not save the photo" }, 400);
      if (host) {
        await enqueue(supabase, user.id, host, "generate_actor", { actor_id: id, seed_asset_id: stored.id }, access.isAdmin);
      }
      const signed = await signActorPacks(supabase, [saved]);
      const shows = await actorShowTitles(supabase, [id]);
      const tasks = await actorGenerateTasks(supabase, user.id, [id]);
      return json(presentActor(saved, signed, { shows: shows.get(id) ?? [], task: tasks.get(id) ?? null }), 202);
    }

    if (req.method === "GET" && path.startsWith("/actors/")) {
      const id = path.split("/")[2];
      const { data } = await supabase.from("actors").select("*").eq("id", id).eq("owner_id", user.id).maybeSingle();
      if (!data) return json({ error: "Not found" }, 404);
      const signed = await signActorPacks(supabase, [data]);
      const { data: roles } = await supabase.from("characters").select("id, series_id, name, locked").eq("actor_id", id);
      const seriesIds = [...new Set((roles ?? []).map((row) => String(row.series_id)))];
      const { data: seriesRows } = seriesIds.length
        ? await supabase.from("series").select("id, title").in("id", seriesIds)
        : { data: [] };
      const titles = new Map((seriesRows ?? []).map((row) => [String(row.id), String(row.title)]));
      const tasks = await actorGenerateTasks(supabase, user.id, [id]);
      return json({
        ...presentActor(data, signed, { shows: [...new Set([...titles.values()])], task: tasks.get(id) ?? null }),
        appearances: (roles ?? []).map((row) => ({
          character_id: row.id,
          series_id: row.series_id,
          series_title: titles.get(String(row.series_id)) ?? "Show",
          role: row.name,
          locked: row.locked,
        })),
      });
    }

    if (req.method === "POST" && path === "/actors") {
      const body = await req.json().catch(() => ({}));
      const name = String(body.name ?? "").trim();
      const description = String(body.description ?? "").trim();
      if (!name) return json({ error: "Name is required" }, 400);
      const seed = typeof body.seed_base64 === "string" && body.seed_base64 ? String(body.seed_base64) : "";
      if (seed) {
        const gate = likenessGate(body.likeness_confirmed === true);
        if (!gate.ok) return json({ error: gate.error }, gate.status);
      }
      const verdict = moderateText(`${name}\n${description}`, "character_create");
      if (verdict.verdict === "block") return json({ error: verdict.reason, reason: verdict.reason }, 422);
      const asked =
        typeof body.series_id === "string" && body.series_id
          ? await ownedSeries(supabase, user.id, body.series_id, access.isAdmin)
          : null;
      const host = asked?.id ?? (await firstOwnedSeriesId(supabase, user.id, access.isAdmin));
      const { data: actor, error } = await supabase
        .from("actors")
        .insert({
          owner_id: user.id,
          name,
          source: seed ? "likeness" : "generated",
          tags: normalizeTags(body.tags),
          notes: description.slice(0, 600),
          identity_fidelity: body.identity_fidelity === "idealized" ? "idealized" : "faithful",
          // A generated face is drawn from this text alone, so a thin note left
          // the model to invent the person and it always invented the same one.
          // A photo brings its own identity and needs no invented traits.
          appearance_profile: seed
            ? { default_wardrobe: "", description }
            : {
                default_wardrobe: "",
                description,
                ...fillAppearance(
                  description,
                  castAppearance({
                    name,
                    gender: inferGenderFromText(`${name} ${description}`),
                    note: description,
                  }),
                ),
              },
        })
        .select("*")
        .single();
      if (error || !actor) return json({ error: error?.message ?? "Could not create actor" }, 400);
      let seedAssetId: string | null = null;
      if (seed) {
        const { error: acceptError } = await supabase.from("legal_acceptances").insert(likenessAcceptanceRow(user.id));
        const acceptProblem = acceptanceWriteError(acceptError?.message);
        if (acceptProblem) return json({ error: acceptProblem }, 400);
        const photo = decodeSeedPhoto(seed, body.seed_mime_type);
        const stored = await putSeedAsset(supabase, {
          ownerId: user.id,
          actorId: String(actor.id),
          seriesId: host,
          bytes: photo.bytes,
          mime: photo.mime,
        });
        seedAssetId = stored.id;
        const { error: seedError } = await supabase
          .from("actors")
          .update({ seed_asset_id: stored.id, source: "likeness", updated_at: new Date().toISOString() })
          .eq("id", actor.id);
        if (seedError) return json({ error: seedError.message }, 400);
        actor.seed_asset_id = stored.id;
      }
      if (host) {
        await enqueue(supabase, user.id, host, "generate_actor", {
          actor_id: actor.id,
          seed_asset_id: seedAssetId ?? undefined,
        }, access.isAdmin);
      }
      const signed = await signActorPacks(supabase, [actor]);
      return json(presentActor(actor, signed), seed || host ? 202 : 201);
    }

    if (req.method === "GET" && path === "/estimate") {
      const sku = Number(url.searchParams.get("sku") ?? url.searchParams.get("episodes"));
      const priority = url.searchParams.get("priority") ?? "balanced";
      const length = url.searchParams.get("length") ?? "60_90";
      const videoTier = url.searchParams.get("video_tier") ?? "pro";
      if (!isSeasonSku(sku)) return json({ error: "sku must be 2|12|15|24|30|45|50|60|90" }, 400);
      if (!isPriority(priority) || !isEpisodeLength(length) || !isVideoTier(videoTier)) {
        return json({ error: "priority, length, or video_tier is invalid" }, 400);
      }
      return json(estimateBlock({ sku, priority, length, video_tier: videoTier }));
    }

    if (req.method === "GET" && path === "/home") {
      return home(supabase, user.id, user.email);
    }

    if (req.method === "GET" && path === "/attention") {
      return attention(supabase, user.id);
    }

    if (req.method === "GET" && path === "/series") {
      const { data, error } = await supabase
        .from("series")
        .select("*")
        .eq("owner_id", user.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) return json({ error: error.message }, 400);
      const covers = await coverMap(supabase, (data ?? []).map((row) => row.cover_asset_id).filter(Boolean));
      return json({ items: (data ?? []).map((row) => seriesCard(row, covers[row.cover_asset_id ?? ""])) });
    }

    if (req.method === "POST" && path === "/series") {
      const body = await req.json();
      const sku = body.sku ?? body.target_episode_count ?? 15;
      if (sku != null && !isSeasonSku(sku)) {
        return json({ error: "sku must be 2|12|15|24|30|45|50|60|90" }, 400);
      }
      const target = isSeasonSku(sku) ? sku : 15;
      const { data, error } = await supabase
        .from("series")
        .insert({
          owner_id: user.id,
          title: body.title,
          description: body.description ?? "",
          target_episode_count: target,
          sku: String(target),
          poster_tone: posterTone(String(body.title ?? user.id)),
          style_profile: {
            aspect: "9:16",
            episode_length: isEpisodeLength(body.episode_length) ? body.episode_length : "60_90",
            video_tier: isVideoTier(body.video_tier) ? body.video_tier : "pro",
          },
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 400);
      const slate = buildCastSlate({ title: String(body.title ?? ""), idea: String(body.description ?? "") });
      const people = slate.filter((slot) => slot.castable);
      if (people.length) {
        await supabase.from("series_cast").insert(
          people.map((slot) => ({
            series_id: data.id,
            actor_id: null,
            character_id: null,
            role_name: null,
            role_note: "",
            job: slot.job,
            archetype: slot.archetype,
            importance: slot.importance,
            castable: slot.castable,
            suggested_name: null,
            suggested_gender: null,
            position: slot.position,
            origin: "slate",
          })),
        );
        await enqueue(supabase, user.id, String(data.id), "plan_cast", {}, access.isAdmin);
      }
      return json({ ...data, estimate: estimateBlock({ sku: 2 }) }, 201);
    }

    if (req.method === "GET" && path.startsWith("/series/")) {
      const parts = path.split("/");
      const id = parts[2];
      const series = await ownedSeries(supabase, user.id, id, access.isAdmin);
      if (!series) return json({ error: "Not found" }, 404);
      if (parts[3] === "balance") {
        return json({ series_id: id, balance: await seriesBalance(supabase, id) });
      }
      if (parts[3] === "estimate") {
        const count = isSeasonSku(series.target_episode_count) ? series.target_episode_count : 2;
        return json({
          series_id: id,
          balance: await seriesBalance(supabase, id),
          estimate: estimateBlock({ sku: count }),
          pilot_required: !series.pilot_approved_at,
        });
      }
      if (parts[3] === "episodes") {
        const { data } = await supabase
          .from("episodes")
          .select("*")
          .eq("series_id", id)
          .order("episode_number", { ascending: true });
        return json({ items: data ?? [] });
      }
      if (parts[3] === "characters") {
        const { data } = await supabase.from("characters").select("*").eq("series_id", id).order("created_at");
        const pack = await signCharacterPacks(supabase, data ?? []);
        return json({
          items: pack.characters.map((row) =>
            presentPackedCharacter(row, pack.signed, { fallback: pack.orphanByCharacter.get(String(row.id)) }),
          ),
        });
      }
      if (parts[3] === "cast") {
        await ensureCastSlate(supabase, {
          id,
          title: series.title,
          description: series.description,
          story_bible: (series.story_bible ?? null) as Record<string, unknown> | null,
        });
        // A slot the writer has since named binds here, so opening the screen
        // never shows a role as uncast when its character already exists.
        await bindCastPlan(supabase, id);
        const [{ data: slots }, { data: characters }, { data: actorRows }] = await Promise.all([
          supabase.from("series_cast").select("*").eq("series_id", id).order("position"),
          supabase.from("characters").select("*").eq("series_id", id).order("created_at"),
          supabase.from("actors").select("*").eq("owner_id", series.owner_id).order("created_at"),
        ]);
        const signed = await signActorPacks(supabase, actorRows ?? []);
        const actorIds = (actorRows ?? []).map((row) => String(row.id));
        const shows = await actorShowTitles(supabase, actorIds);
        const tasks = await actorGenerateTasks(supabase, series.owner_id, actorIds);
        const roster = (actorRows ?? []).map((row) =>
          presentActor(row, signed, { shows: shows.get(String(row.id)) ?? [], task: tasks.get(String(row.id)) ?? null }),
        );
        const actorById = new Map(roster.map((row) => [String(row.id), row]));
        const pack = await signCharacterPacks(supabase, characters ?? []);
        const packed = pack.characters.map((row) =>
          presentPackedCharacter(row, pack.signed, { fallback: pack.orphanByCharacter.get(String(row.id)) }),
        );
        const characterById = new Map(packed.map((row) => [String(row.id), row]));
        const rank = (importance: string | null | undefined) =>
          importance === "lead" ? 0 : importance === "supporting" ? 1 : 2;
        const items = ((slots ?? []) as CastSlotRow[])
          // Non-castable story devices are material for the design slate.
          // They may remain as internal planning rows, but never belong in the
          // public cast response or actor UI.
          .filter((row) => row.castable !== false)
          .slice()
          .sort((left, right) => rank(left.importance) - rank(right.importance) || (left.position ?? 0) - (right.position ?? 0))
          .map((row) =>
            presentCastSlot(row, {
              actor: row.actor_id ? (actorById.get(row.actor_id) ?? null) : null,
              character: row.character_id ? (characterById.get(row.character_id) ?? null) : null,
            }),
          );
        if (items.some((row) => row.castable && (!row.named || !row.suggested_gender))) {
          await enqueue(supabase, user.id, id, "plan_cast", {}, access.isAdmin);
        }
        // Roles the story wrote that nobody has claimed a slot for yet.
        const claimed = new Set(
          items.map((row) => String(row.role_name ?? row.display_name ?? "").trim().toLowerCase()).filter(Boolean),
        );
        const unclaimed = packed.filter((row) => !claimed.has(String(row.name).trim().toLowerCase()));
        return json({
          series_id: id,
          series_title: series.title,
          items,
          roles: packed,
          unclaimed,
          roster,
          slate_ready: items.some((row) => Boolean(row.job)),
          naming: items.some((row) => row.castable && !row.named),
          /** Before the story exists the buyer names the parts themselves. */
          story_written: Boolean(series.story_bible),
        });
      }
      if (parts[3] === "design") {
        await ensureDesignSlate(supabase, {
          id,
          title: series.title,
          description: series.description,
          story_bible: (series.story_bible ?? null) as Record<string, unknown> | null,
          location_refs: (series.location_refs ?? null) as Record<string, unknown> | null,
        });
        const [{ data: locationRows }, { data: propRows }] = await Promise.all([
          supabase.from("series_locations").select("*").eq("series_id", id).order("position"),
          supabase.from("series_props").select("*").eq("series_id", id).order("position"),
        ]);
        const locations = (locationRows ?? []) as LocationRow[];
        const props = (propRows ?? []) as PropRow[];
        const signed = await signDesignAssets(supabase, id, [
          ...locations.map((row) => String(row.plate_asset_id ?? "")),
          ...props.map((row) => String(row.still_asset_id ?? "")),
        ]);
        return json({
          series_id: id,
          series_title: series.title,
          locations: locations.map((row) => {
            const plateId = String(row.plate_asset_id ?? "");
            const angles = (signed.anglesByLocation.get(row.name.trim()) ?? []).filter(
              (angle) => !angle.plate_id || !plateId || angle.plate_id === plateId,
            );
            return presentLocation(row, {
              plate_url: plateId ? (signed.byId.get(plateId) ?? null) : null,
              angles,
            });
          }),
          props: props.map((row) =>
            presentProp(row, {
              still_url: row.still_asset_id ? (signed.byId.get(String(row.still_asset_id)) ?? null) : null,
              angles: row.still_asset_id ? (signed.anglesByStill.get(String(row.still_asset_id)) ?? []) : [],
              document_text: row.still_asset_id ? (signed.documentById.get(String(row.still_asset_id)) ?? null) : null,
            }),
          ),
          /** Before the story exists these come from the brief and can be changed. */
          story_written: Boolean(series.story_bible),
        });
      }
      /**
       * What is still missing before this show can be shot. Repairs both slates
       * first, so a draft nobody has opened yet reports its real work rather
       * than an empty and misleadingly finished list.
       */
      if (parts[3] === "readiness") {
        await ensureCastSlate(supabase, series);
        await ensureDesignSlate(supabase, {
          id,
          title: series.title,
          description: series.description,
          story_bible: (series.story_bible ?? null) as Record<string, unknown> | null,
          location_refs: (series.location_refs ?? null) as Record<string, unknown> | null,
        });
        const readiness = await seriesReadiness(supabase, id);
        const storyWritten = Boolean(series.story_bible);
        return json({
          series_id: id,
          story_written: storyWritten,
          ...readiness,
          can_start: storyWritten && readiness.can_start,
          blocking: storyWritten ? readiness.blocking : ["The story has not been written yet", ...readiness.blocking],
        });
      }
      if (parts[3] === "continuity") {
        const bible = series.story_bible ?? {};
        return json({
          series_id: id,
          locations: bible.locations ?? [],
          characters: bible.characters ?? [],
          location_refs: series.location_refs ?? {},
        });
      }
      if (parts.length === 3) {
        const [{ count: episodeCount }, { data: characters }, { data: productions }] = await Promise.all([
          supabase.from("episodes").select("id", { count: "exact", head: true }).eq("series_id", id),
          supabase.from("characters").select("*").eq("series_id", id),
          supabase
            .from("productions")
            .select("*")
            .eq("series_id", id)
            .order("created_at", { ascending: false })
            .limit(12),
        ]);
        const productionRows = (productions ?? []).map((row) => publicProduction(row as ProductionRow));
        const next = seriesNextAction({
          pilot_approved: Boolean(series.pilot_approved_at),
          productions: productionRows,
        });
        const covers = await coverMap(supabase, [String(series.cover_asset_id ?? "")]);
        const pack = await signCharacterPacks(supabase, characters ?? []);
        return json({
          ...series,
          poster_tone: seriesPoster(series),
          cover_url: covers[String(series.cover_asset_id ?? "")] ?? null,
          episode_count: episodeCount ?? 0,
          characters: pack.characters.map((row) =>
            presentPackedCharacter(row, pack.signed, { fallback: pack.orphanByCharacter.get(String(row.id)) }),
          ),
          productions: productionRows,
          pilot_approved: Boolean(series.pilot_approved_at),
          pilot_required: !series.pilot_approved_at,
          paid: next.next_action !== "pay_pilot" && next.next_action !== "continue_draft",
          next_action: next.next_action,
          active_production_id: next.active_production_id,
          can_discard: productionRows.every((row) => Number(row.paid_amount ?? 0) <= 0),
          episode_length:
            (productionRows[0] as { episode_length?: string } | undefined)?.episode_length ??
            (series.style_profile as { episode_length?: string } | null)?.episode_length ??
            "60_90",
          video_tier:
            (productionRows[0] as { video_tier?: string } | undefined)?.video_tier ??
            (series.style_profile as { video_tier?: string } | null)?.video_tier ??
            "pro",
        });
      }
    }

    /**
     * A show before it is paid for.
     *
     * The brief used to buy a run in one click, which meant the buyer never saw
     * the faces, rooms and objects their money was about to be spent on. Now the
     * brief makes a draft, both slates are built from it, and the run is bought
     * from the show page once all three are approved.
     */
    if (req.method === "POST" && path === "/series") {
      const body = await req.json().catch(() => ({}));
      const title = String(body.title ?? "").trim().slice(0, 200);
      const description = String(body.description ?? "").trim();
      if (!title) return json({ error: "Give the show a title" }, 400);
      const verdict = moderateText(`${title}\n${description}`, "story_input");
      if (verdict.verdict === "block") {
        return json({ error: "content_policy", reason: verdict.reason, allowed: false }, 422);
      }
      const sku = isBlockSku(body.sku) ? body.sku : 15;
      const length = isEpisodeLength(body.episode_length) ? body.episode_length : "60_90";
      const tier = isVideoTier(body.video_tier) ? body.video_tier : "pro";
      const target = sku === 2 ? 60 : sku;

      // Reuse the draft the buyer is editing instead of stacking up new ones.
      const existing = typeof body.series_id === "string" && body.series_id
        ? await ownedSeries(supabase, user.id, body.series_id, access.isAdmin)
        : null;
      const patch = {
        title,
        description,
        target_episode_count: target,
        sku: String(target),
        style_profile: {
          ...((existing?.style_profile as Record<string, unknown> | null) ?? {}),
          aspect: "9:16",
          episode_length: length,
          video_tier: tier,
        },
      };
      const saved = existing
        ? await supabase.from("series").update(patch).eq("id", existing.id).select().single()
        : await supabase
            .from("series")
            .insert({ owner_id: user.id, ...patch, poster_tone: posterTone(title) })
            .select()
            .single();
      if (saved.error || !saved.data) {
        return json({ error: saved.error?.message ?? "Could not save the draft" }, 400);
      }
      const series = saved.data;

      if (typeof body.script_text === "string" && body.script_text.trim()) {
        await supabase.from("engine_tasks").insert({
          owner_id: user.id,
          series_id: series.id,
          action: "attach_script",
          payload: { script_text: body.script_text },
          status: "queued",
        });
      }

      // Build both slates now so the show page opens on real work to approve.
      await ensureCastSlate(supabase, series);
      await ensureDesignSlate(supabase, {
        id: series.id,
        title: series.title,
        description: series.description,
        story_bible: null,
        location_refs: (series.location_refs ?? null) as Record<string, unknown> | null,
      });
      await enqueue(supabase, user.id, series.id, "plan_cast", {}, access.isAdmin);

      return json({ id: series.id, title: series.title, series_id: series.id }, existing ? 200 : 201);
    }

    if (req.method === "DELETE" && /^\/series\/[^/]+$/.test(path)) {
      const id = path.split("/")[2];
      const series = await ownedSeries(supabase, user.id, id, access.isAdmin);
      if (!series) return json({ error: "Not found" }, 404);
      const result = await discardUnpaidSeries(supabase, id);
      if ("error" in result) return json({ error: result.error }, result.status);
      return json({ ok: true, discarded: id });
    }

    // Production design: rooms and objects, each generated on its own.
    if (req.method === "POST" && /^\/series\/[^/]+\/(locations|props)$/.test(path)) {
      const [, , seriesId, bucket] = path.split("/");
      const series = await ownedSeries(supabase, user.id, seriesId, access.isAdmin);
      if (!series) return json({ error: "Not found" }, 404);
      const body = await req.json().catch(() => ({}));
      const name = normalizeDesignName(body.name);
      if (!name) return json({ error: bucket === "props" ? "Name the object" : "Name the place" }, 400);
      const verdict = moderateText(name, "story_input");
      if (verdict.verdict === "block") return json({ error: verdict.reason, reason: verdict.reason }, 422);
      const table = bucket === "props" ? "series_props" : "series_locations";
      const { count } = await supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("series_id", seriesId);
      const row: Record<string, unknown> = {
        series_id: seriesId,
        name,
        note: typeof body.note === "string" ? body.note.slice(0, 300) : "",
        origin: "buyer",
        position: count ?? 0,
        status: "planned",
      };
      if (bucket === "props") row.kind = propKindFor(name);
      const { data, error } = await supabase.from(table).insert(row).select("*").single();
      if (error) {
        const duplicate = error.code === "23505";
        return json({ error: duplicate ? "That is already on this show." : error.message }, duplicate ? 409 : 400);
      }
      return json(
        bucket === "props" ? presentProp(data as PropRow) : presentLocation(data as LocationRow),
        201,
      );
    }

    if (req.method === "POST" && /^\/series\/[^/]+\/(locations|props)\/[^/]+\/generate$/.test(path)) {
      const [, , seriesId, bucket, rowId] = path.split("/");
      const series = await ownedSeries(supabase, user.id, seriesId, access.isAdmin);
      if (!series) return json({ error: "Not found" }, 404);
      const body = await req.json().catch(() => ({}));
      const table = bucket === "props" ? "series_props" : "series_locations";
      const { data: row } = await supabase
        .from(table)
        .select("id, locked")
        .eq("id", rowId)
        .eq("series_id", seriesId)
        .maybeSingle();
      if (!row) return json({ error: "Not found" }, 404);
      // A set that has already been shot keeps its plate; changing it now would
      // break continuity with every take already in the can.
      if (row.locked) {
        return json({ error: "This has already been shot. Its look stays the same." }, 409);
      }
      const action = bucket === "props" ? "generate_prop_still" : "generate_location_plate";
      const payload = bucket === "props"
        ? { prop_id: String(row.id), force: Boolean(body.force) }
        : { location_id: String(row.id), force: Boolean(body.force) };
      const queued = await enqueue(supabase, user.id, seriesId, action, payload, access.isAdmin);
      // Mark it building now, not when a worker claims it. The cron runs once a
      // minute, and until then the card would still read "Not built yet".
      if (queued.ok) {
        await supabase
          .from(table)
          .update({ status: "building", error: null, updated_at: new Date().toISOString() })
          .eq("id", row.id);
      }
      return queued;
    }

    if (req.method === "POST" && /^\/series\/[^/]+\/(locations|props)\/generate$/.test(path)) {
      const [, , seriesId, bucket] = path.split("/");
      const series = await ownedSeries(supabase, user.id, seriesId, access.isAdmin);
      if (!series) return json({ error: "Not found" }, 404);
      const table = bucket === "props" ? "series_props" : "series_locations";
      const column = bucket === "props" ? "still_asset_id" : "plate_asset_id";
      const { data: rows } = await supabase
        .from(table)
        .select(`id, locked, status, ${column}`)
        .eq("series_id", seriesId)
        .order("position");
      const missing = ((rows ?? []) as Array<Record<string, unknown>>).filter(
        (item) => !item.locked && !item[column] && item.status !== "building",
      );
      const started: string[] = [];
      for (const item of missing) {
        const payload = bucket === "props" ? { prop_id: String(item.id) } : { location_id: String(item.id) };
        const action = bucket === "props" ? "generate_prop_still" : "generate_location_plate";
        const queued = await enqueue(supabase, user.id, seriesId, action, payload, access.isAdmin);
        if (queued.ok) started.push(String(item.id));
      }
      // Same reason as the single build: the cards have to show the work at once.
      if (started.length) {
        await supabase
          .from(table)
          .update({ status: "building", error: null, updated_at: new Date().toISOString() })
          .in("id", started);
      }
      return json({ queued: started.length }, 202);
    }

    if (req.method === "PATCH" && /^\/series\/[^/]+\/(locations|props)\/[^/]+$/.test(path)) {
      const [, , seriesId, bucket, rowId] = path.split("/");
      const series = await ownedSeries(supabase, user.id, seriesId, access.isAdmin);
      if (!series) return json({ error: "Not found" }, 404);
      const body = await req.json().catch(() => ({}));
      const table = bucket === "props" ? "series_props" : "series_locations";
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.name === "string") {
        const name = normalizeDesignName(body.name);
        if (!name) return json({ error: "Name it" }, 400);
        const verdict = moderateText(name, "story_input");
        if (verdict.verdict === "block") return json({ error: verdict.reason, reason: verdict.reason }, 422);
        patch.name = name;
        if (bucket === "props") patch.kind = propKindFor(name);
      }
      if (typeof body.note === "string") patch.note = body.note.slice(0, 300);
      const { data: row } = await supabase
        .from(table)
        .select("id, locked")
        .eq("id", rowId)
        .eq("series_id", seriesId)
        .maybeSingle();
      if (!row) return json({ error: "Not found" }, 404);
      if (row.locked && patch.name) {
        return json({ error: "This has already been shot. Its name stays the same." }, 409);
      }
      const { data, error } = await supabase.from(table).update(patch).eq("id", rowId).select("*").single();
      if (error) {
        const duplicate = error.code === "23505";
        return json({ error: duplicate ? "That is already on this show." : error.message }, duplicate ? 409 : 400);
      }
      return json(bucket === "props" ? presentProp(data as PropRow) : presentLocation(data as LocationRow));
    }

    if (req.method === "DELETE" && /^\/series\/[^/]+\/(locations|props)\/[^/]+$/.test(path)) {
      const [, , seriesId, bucket, rowId] = path.split("/");
      const series = await ownedSeries(supabase, user.id, seriesId, access.isAdmin);
      if (!series) return json({ error: "Not found" }, 404);
      const table = bucket === "props" ? "series_props" : "series_locations";
      const { data: row } = await supabase
        .from(table)
        .select("id, locked")
        .eq("id", rowId)
        .eq("series_id", seriesId)
        .maybeSingle();
      if (!row) return json({ error: "Not found" }, 404);
      if (row.locked) return json({ error: "This has already been shot. It cannot be removed." }, 409);
      const { error } = await supabase.from(table).delete().eq("id", rowId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, removed: rowId });
    }

    /**
     * The owner's catalog of places and objects.
     *
     * Routes read `/places` and `/objects` because those are the words the design
     * screen uses; the tables behind them are `locations` and `props`, matching
     * the per-show `series_locations` and `series_props` they get attached to.
     */
    if (/^\/(places|objects)(\/|$)/.test(path)) {
      const isObject = path.startsWith("/objects");
      const table = isObject ? "props" : "locations";
      const imageColumn = isObject ? "still_asset_id" : "plate_asset_id";
      const action = isObject ? "generate_object" : "generate_place";
      const payloadKey = isObject ? "object_id" : "place_id";
      const noun = isObject ? "object" : "place";
      const present = (row: Record<string, unknown>, extras: Parameters<typeof presentPropEntry>[1]) =>
        isObject ? presentPropEntry(row as PropEntry, extras) : presentLocationEntry(row as LocationEntry, extras);
      const segments = path.split("/").filter(Boolean);
      const entryId = segments[1] ?? "";
      const verb = segments[2] ?? "";

      const loadEntry = async () => {
        const { data } = await supabase
          .from(table)
          .select("*")
          .eq("id", entryId)
          .eq("owner_id", user.id)
          .maybeSingle();
        return data as (LocationEntry & PropEntry) | null;
      };

      /** Builds it now if the buyer sent a picture, or queues the engine if not. */
      const seedOrQueue = async (entry: Record<string, unknown>, body: Record<string, unknown>) => {
        const raw = typeof body.image_base64 === "string" ? body.image_base64 : "";
        if (raw) {
          const image = decodeLibraryImage(raw, typeof body.image_mime_type === "string" ? body.image_mime_type : undefined);
          const stored = await putLibraryImage(supabase, {
            ownerId: user.id,
            kind: isObject ? "prop" : "location",
            entryId: String(entry.id),
            bytes: image.bytes,
            mime: image.mime,
            role: "plate",
          });
          const { data } = await supabase
            .from(table)
            .update({
              [imageColumn]: stored.id,
              seed_asset_id: stored.id,
              source: "upload",
              status: "ready",
              error: null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", entry.id)
            .select("*")
            .single();
          return { row: data as Record<string, unknown>, queued: false };
        }
        // Owner-level work still needs a show to bill and trail it against, the
        // same way an actor's face pack does.
        const host = await firstOwnedSeriesId(supabase, user.id, access.isAdmin);
        if (!host) return { row: entry, queued: false };
        const queued = await enqueue(supabase, user.id, host, action, { [payloadKey]: String(entry.id) }, access.isAdmin);
        if (!queued.ok) return { row: entry, queued: false };
        const { data } = await supabase
          .from(table)
          .update({ status: "building", error: null, updated_at: new Date().toISOString() })
          .eq("id", entry.id)
          .select("*")
          .single();
        return { row: (data ?? entry) as Record<string, unknown>, queued: true };
      };

      if (req.method === "GET" && segments.length === 1) {
        const { data } = await supabase
          .from(table)
          .select("*")
          .eq("owner_id", user.id)
          .order("created_at", { ascending: false });
        const rows = (data ?? []) as Array<Record<string, unknown>>;
        const [signed, shows, angles] = await Promise.all([
          signLibraryImages(supabase, rows.flatMap((row) => [String(row[imageColumn] ?? ""), String(row.seed_asset_id ?? "")])),
          libraryShowTitles(supabase, isObject ? "prop" : "location", rows.map((row) => String(row.id))),
          isObject
            ? Promise.resolve(new Map())
            : signLibraryLocationAngles(supabase, user.id, rows.map((row) => String(row.plate_asset_id ?? ""))),
        ]);
        const tags = new Set<string>();
        for (const row of rows) for (const tag of (row.tags as string[] | null) ?? []) tags.add(tag);
        return json({
          items: rows.map((row) =>
            present(row, {
              image_url: signed.get(String(row[imageColumn] ?? "")) ?? null,
              seed_url: signed.get(String(row.seed_asset_id ?? "")) ?? null,
              angles: isObject ? undefined : angles.get(String(row.plate_asset_id ?? "")) ?? [],
              shows: shows.get(String(row.id)) ?? [],
            }),
          ),
          tags: [...tags].sort(),
        });
      }

      if (req.method === "POST" && segments.length === 1) {
        const body = await req.json().catch(() => ({}));
        const name = normalizeLibraryName(body.name);
        if (!name) return json({ error: isObject ? "Name the object" : "Name the place" }, 400);
        const verdict = moderateText(name, "story_input");
        if (verdict.verdict === "block") return json({ error: verdict.reason, reason: verdict.reason }, 422);
        const { data, error } = await supabase
          .from(table)
          .insert({
            owner_id: user.id,
            name,
            source: "generated",
            notes: typeof body.notes === "string" ? body.notes.slice(0, 600) : "",
            tags: normalizeTags(body.tags),
            status: "planned",
          })
          .select("*")
          .single();
        if (error) {
          const duplicate = error.code === "23505";
          return json(
            { error: duplicate ? `You already have a ${noun} with that name.` : error.message },
            duplicate ? 409 : 400,
          );
        }
        const seeded = await seedOrQueue(data as Record<string, unknown>, body);
        return json(present(seeded.row, {}), seeded.queued ? 202 : 201);
      }

      if (req.method === "GET" && segments.length === 2) {
        const entry = await loadEntry();
        if (!entry) return json({ error: "Not found" }, 404);
        const row = entry as unknown as Record<string, unknown>;
        const [signed, shows, angles] = await Promise.all([
          signLibraryImages(supabase, [String(row[imageColumn] ?? ""), String(row.seed_asset_id ?? "")]),
          libraryShowTitles(supabase, isObject ? "prop" : "location", [entry.id]),
          isObject
            ? Promise.resolve(new Map())
            : signLibraryLocationAngles(supabase, user.id, [String(row.plate_asset_id ?? "")]),
        ]);
        return json(
          present(row, {
            image_url: signed.get(String(row[imageColumn] ?? "")) ?? null,
            seed_url: signed.get(String(row.seed_asset_id ?? "")) ?? null,
            angles: isObject ? undefined : angles.get(String(row.plate_asset_id ?? "")) ?? [],
            shows: shows.get(entry.id) ?? [],
          }),
        );
      }

      if (req.method === "PATCH" && segments.length === 2) {
        const entry = await loadEntry();
        if (!entry) return json({ error: "Not found" }, 404);
        const body = await req.json().catch(() => ({}));
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (typeof body.name === "string") {
          const name = normalizeLibraryName(body.name);
          if (!name) return json({ error: "Name it" }, 400);
          const verdict = moderateText(name, "story_input");
          if (verdict.verdict === "block") return json({ error: verdict.reason, reason: verdict.reason }, 422);
          patch.name = name;
        }
        if (typeof body.notes === "string") patch.notes = body.notes.slice(0, 600);
        if (body.tags !== undefined) patch.tags = normalizeTags(body.tags);
        if (isObject && typeof body.state === "string") patch.state = body.state.slice(0, 40);
        const { data, error } = await supabase.from(table).update(patch).eq("id", entry.id).select("*").single();
        if (error) {
          const duplicate = error.code === "23505";
          return json(
            { error: duplicate ? `You already have a ${noun} with that name.` : error.message },
            duplicate ? 409 : 400,
          );
        }
        return json(present(data as Record<string, unknown>, {}));
      }

      if (req.method === "DELETE" && segments.length === 2) {
        const entry = await loadEntry();
        if (!entry) return json({ error: "Not found" }, 404);
        // A show that already used this keeps its own copy of the picture, so
        // removing the catalog entry never changes footage.
        const { error } = await supabase.from(table).delete().eq("id", entry.id);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true, removed: entry.id });
      }

      if (req.method === "POST" && segments.length === 3 && (verb === "generate" || verb === "image")) {
        const entry = await loadEntry();
        if (!entry) return json({ error: "Not found" }, 404);
        const body = await req.json().catch(() => ({}));
        if (verb === "image" && typeof body.image_base64 !== "string") {
          return json({ error: "An image is required" }, 400);
        }
        const seeded = await seedOrQueue(entry as unknown as Record<string, unknown>, verb === "generate" ? {} : body);
        return json(present(seeded.row, {}), seeded.queued ? 202 : 200);
      }

      return json({ error: "Not found" }, 404);
    }

    /** Points one of a show's rooms or objects at a catalog entry. */
    if (req.method === "POST" && /^\/series\/[^/]+\/(locations|props)\/[^/]+\/use$/.test(path)) {
      const [, , seriesId, bucket, rowId] = path.split("/");
      const series = await ownedSeries(supabase, user.id, seriesId, access.isAdmin);
      if (!series) return json({ error: "Not found" }, 404);
      const body = await req.json().catch(() => ({}));
      const entryId = String(body.entry_id ?? "");
      if (!entryId) return json({ error: "Pick one from your library" }, 400);
      const isObject = bucket === "props";
      const { data: row } = await supabase
        .from(isObject ? "series_props" : "series_locations")
        .select("id, name, locked")
        .eq("id", rowId)
        .eq("series_id", seriesId)
        .maybeSingle();
      if (!row) return json({ error: "Not found" }, 404);
      const { data: entry } = await supabase
        .from(isObject ? "props" : "locations")
        .select("*")
        .eq("id", entryId)
        .eq("owner_id", user.id)
        .maybeSingle();
      if (!entry) return json({ error: "That is not in your library" }, 404);
      const target = { id: String(row.id), name: String(row.name), locked: Boolean(row.locked) };
      const result = isObject
        ? await usePropEntry(supabase, { ownerId: user.id, seriesId, row: target, entry: entry as PropEntry })
        : await useLocationEntry(supabase, { ownerId: user.id, seriesId, row: target, entry: entry as LocationEntry });
      if (result.error) return json({ error: result.error }, 409);
      // The copied plate is a new seed. Fill the rest of the pack on this show
      // so Design never presents a one-shot as ready.
      await supabase
        .from(isObject ? "series_props" : "series_locations")
        .update({ status: "building", error: null, updated_at: new Date().toISOString() })
        .eq("id", rowId);
      const queued = await enqueue(
        supabase,
        user.id,
        seriesId,
        isObject ? "generate_prop_still" : "generate_location_plate",
        isObject ? { prop_id: rowId } : { location_id: rowId },
        access.isAdmin,
      );
      if (!queued.ok) return queued;
      return json({ ok: true, used: entryId, queued: true }, 202);
    }

    if (req.method === "POST" && /^\/series\/[^/]+\/cast\/generate$/.test(path)) {
      const seriesId = path.split("/")[2];
      const series = await ownedSeries(supabase, user.id, seriesId, access.isAdmin);
      if (!series) return json({ error: "Not found" }, 404);
      const body = await req.json().catch(() => ({}));
      const slotIds = Array.isArray(body.slot_ids) ? (body.slot_ids as unknown[]).map((item) => String(item)) : [];
      const { created, unnamed } = await generateMissingFaces(supabase, {
        ownerId: user.id,
        seriesId,
        slotIds: slotIds.length ? slotIds : undefined,
      });
      if (unnamed > 0) {
        await enqueue(supabase, user.id, seriesId, "plan_cast", {}, access.isAdmin);
      }
      if (!created.length && unnamed > 0) {
        return json({ error: "The parts are still being named. Wait a moment, then generate faces.", naming: true, generated: 0 }, 409);
      }
      for (const row of created) {
        await enqueue(supabase, user.id, seriesId, "generate_actor", { actor_id: row.actorId }, access.isAdmin);
      }
      return json({ generated: created.length, naming: unnamed > 0, items: created.map((row) => presentCastSlot(row.slot)) }, 202);
    }

    if (req.method === "POST" && /^\/series\/[^/]+\/cast$/.test(path)) {
      const seriesId = path.split("/")[2];
      const series = await ownedSeries(supabase, user.id, seriesId, access.isAdmin);
      if (!series) return json({ error: "Not found" }, 404);
      const body = await req.json().catch(() => ({}));
      const roleName = normalizeRoleName(body.role_name);
      const slotId = typeof body.slot_id === "string" && body.slot_id ? String(body.slot_id) : "";
      if (!roleName && !slotId) return json({ error: "A role name is required" }, 400);
      if (roleName) {
        const verdict = moderateText(roleName, "character_create");
        if (verdict.verdict === "block") return json({ error: verdict.reason, reason: verdict.reason }, 422);
      }

      let actorId: string | null = null;
      if (typeof body.actor_id === "string" && body.actor_id) {
        const { data: actor } = await supabase
          .from("actors")
          .select("id")
          .eq("id", body.actor_id)
          .eq("owner_id", user.id)
          .maybeSingle();
        if (!actor) return json({ error: "That actor is not in your catalog." }, 404);
        actorId = String(actor.id);
      }

      // The role may already be a written character, either because the caller
      // named it or because the story did.
      const { data: characters } = await supabase
        .from("characters")
        .select("id, name, locked")
        .eq("series_id", seriesId);
      const { data: existing } = await supabase.from("series_cast").select("*").eq("series_id", seriesId);
      const byId = slotId ? (existing ?? []).find((row) => String(row.id) === slotId) : null;
      const wanted = roleName || String(byId?.role_name || byId?.suggested_name || "").trim();
      const character =
        (typeof body.character_id === "string" && body.character_id
          ? (characters ?? []).find((row) => String(row.id) === body.character_id)
          : wanted
            ? (characters ?? []).find((row) => String(row.name).trim().toLowerCase() === wanted.toLowerCase())
            : null) ?? null;
      if (character?.locked) {
        return json({ error: "This role already shot. Its face stays locked." }, 409);
      }

      const match =
        byId ??
        (wanted
          ? (existing ?? []).find((row) => String(row.role_name ?? "").trim().toLowerCase() === wanted.toLowerCase())
          : null);
      const payload = {
        series_id: seriesId,
        role_name: character ? String(character.name) : wanted || null,
        role_note: String(body.role_note ?? match?.role_note ?? "").trim().slice(0, 300),
        actor_id: actorId,
        character_id: character ? String(character.id) : match?.character_id ?? null,
        updated_at: new Date().toISOString(),
      };
      const written = match
        ? await supabase.from("series_cast").update(payload).eq("id", match.id).select("*").single()
        : await supabase
            .from("series_cast")
            .insert({
              ...payload,
              job: null,
              importance: "background",
              castable: true,
              origin: "buyer",
              position: (existing ?? []).length,
            })
            .select("*")
            .single();
      const { data: slot, error } = written;
      if (error || !slot) return json({ error: error?.message ?? "Could not save the cast" }, 400);

      if (character && actorId) {
        await castActorOnCharacter(supabase, String(character.id), actorId);
        // A face with no stills yet needs generating before wardrobe can run.
        const { data: actorRow } = await supabase
          .from("actors")
          .select("visual_reference_asset_ids")
          .eq("id", actorId)
          .maybeSingle();
        const refs = (actorRow?.visual_reference_asset_ids ?? {}) as Record<string, unknown>;
        if (Object.keys(refs).length === 0) {
          await enqueue(supabase, user.id, seriesId, "generate_actor", { actor_id: actorId }, access.isAdmin);
        }
        // Wardrobe is dressed from the story's looks, so it can only run once the
        // story exists.
        if (series.story_bible) {
          await enqueue(
            supabase,
            user.id,
            seriesId,
            "generate_wardrobe",
            { character_id: character.id },
            access.isAdmin,
          );
        }
      }
      return json(presentCastSlot(slot as CastSlotRow), 201);
    }

    if (req.method === "DELETE" && /^\/series\/[^/]+\/cast\/[^/]+$/.test(path)) {
      const [, , seriesId, , slotId] = path.split("/");
      const series = await ownedSeries(supabase, user.id, seriesId, access.isAdmin);
      if (!series) return json({ error: "Not found" }, 404);
      const { data: slot } = await supabase
        .from("series_cast")
        .select("*")
        .eq("id", slotId)
        .eq("series_id", seriesId)
        .maybeSingle();
      if (!slot) return json({ error: "Not found" }, 404);
      if (slot.character_id) {
        const { data: character } = await supabase
          .from("characters")
          .select("locked")
          .eq("id", slot.character_id)
          .maybeSingle();
        if (character?.locked) return json({ error: "This role already shot." }, 409);
        // Drop the chosen face so the run writes a fresh one.
        await supabase
          .from("characters")
          .update({ actor_id: null, updated_at: new Date().toISOString() })
          .eq("id", slot.character_id);
      }
      const { error } = await supabase.from("series_cast").delete().eq("id", slotId).eq("series_id", seriesId);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, deleted: slotId });
    }

    if (req.method === "POST" && /\/series\/[^/]+\/analyze$/.test(path)) {
      return enqueue(supabase, user.id, path.split("/")[2], "analyze", {}, access.isAdmin);
    }

    if (req.method === "POST" && /\/series\/[^/]+\/lock-locations$/.test(path)) {
      return enqueue(supabase, user.id, path.split("/")[2], "lock_locations", {}, access.isAdmin);
    }

    if (req.method === "POST" && /\/series\/[^/]+\/approve-pilot$/.test(path)) {
      const seriesId = path.split("/")[2];
      const series = await ownedSeries(supabase, user.id, seriesId, access.isAdmin);
      if (!series) return json({ error: "Not found" }, 404);
      const { data, error } = await supabase
        .from("series")
        .update({ pilot_approved_at: new Date().toISOString() })
        .eq("id", seriesId)
        .select()
        .single();
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, series: data });
    }

    if (req.method === "GET" && path === "/productions") {
      const status = url.searchParams.get("status");
      let query = supabase
        .from("productions")
        .select("*")
        .eq("owner_id", user.id)
        .neq("status", "cancelled")
        .order("updated_at", { ascending: false });
      if (status === "running") query = query.in("status", ["queued", "running"]);
      else if (status && status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) return json({ error: error.message }, 400);
      const seriesIds = [...new Set((data ?? []).map((row) => row.series_id))];
      const { data: seriesRows } = seriesIds.length
        ? await supabase.from("series").select("id, title, poster_tone, cover_asset_id").in("id", seriesIds)
        : { data: [] };
      const seriesById = Object.fromEntries((seriesRows ?? []).map((row) => [row.id, row]));
      const covers = await coverMap(supabase, (seriesRows ?? []).map((row) => row.cover_asset_id).filter(Boolean));
      return json({
        items: (data ?? []).map((row) =>
          publicProduction(row as ProductionRow, {
            series_title: seriesById[row.series_id]?.title ?? "Series",
            poster_tone: seriesPoster(seriesById[row.series_id] ?? { id: row.series_id }),
            cover_url: covers[seriesById[row.series_id]?.cover_asset_id ?? ""] ?? null,
          }),
        ),
      });
    }

    if (req.method === "POST" && path === "/productions") {
      return createProduction(req, supabase, user.id, user.email, access.isAdmin);
    }

    if (req.method === "GET" && path.startsWith("/productions/")) {
      const id = path.split("/")[2];
      const { data } = await supabase.from("productions").select("*").eq("id", id).maybeSingle();
      if (!data || (data.owner_id !== user.id && !access.isAdmin)) return json({ error: "Not found" }, 404);
      const series = await ownedSeries(supabase, user.id, data.series_id, true);
      const { data: episodes } = await supabase
        .from("episodes")
        .select("*")
        .eq("series_id", data.series_id)
        .gte("episode_number", data.episode_start)
        .lte("episode_number", data.episode_end)
        .order("episode_number");
      const { data: tasks } = await supabase
        .from("engine_tasks")
        .select("id, action, status, error_code, payload, created_at, updated_at")
        .eq("production_id", id)
        .order("created_at", { ascending: false })
        .limit(40);
      const { data: characters } = await supabase
        .from("characters")
        .select("*")
        .eq("series_id", data.series_id)
        .order("created_at");
      const { data: shotRows } = await supabase
        .from("assets")
        .select("id, kind, mime_type, storage_path, metadata, created_at")
        .eq("series_id", data.series_id)
        .eq("kind", "shot_video")
        .is("deleted_at", null);
      const coverId = series?.cover_asset_id as string | undefined;
      const { data: coverRows } = coverId
        ? await supabase
            .from("assets")
            .select("id, kind, mime_type, storage_path, metadata, created_at")
            .eq("id", coverId)
            .is("deleted_at", null)
        : { data: [] };
      const orderedShots = sortShotVideoRows(
        (shotRows ?? []).map((row) => ({ ...row, metadata: (row.metadata ?? {}) as Record<string, unknown> })),
      );
      const feed = await signAssetRows(orderedShots);
      const signedCover = await signAssetRows(coverRows ?? []);
      const cover = signedCover[0] ?? null;
      const stillsByCharacter = new Map<string, { id: string; url: string }>();
      try {
        const stillIds = (characters ?? [])
          .map((character) => characterStillIds(character)[0])
          .filter((id): id is string => Boolean(id));
        const { data: stillRows } = stillIds.length
          ? await supabase
              .from("assets")
              .select("id, kind, mime_type, storage_path, metadata, created_at")
              .in("id", [...new Set(stillIds)])
              .is("deleted_at", null)
          : { data: [] };
        const { data: orphanStills } = await supabase
          .from("assets")
          .select("id, kind, mime_type, storage_path, metadata, created_at")
          .eq("series_id", data.series_id)
          .eq("kind", "character_reference")
          .is("deleted_at", null)
          .order("created_at", { ascending: false });
        const signedStills = await signAssetRows([...(stillRows ?? []), ...(orphanStills ?? [])]);
        for (const character of characters ?? []) {
          const preferred =
            characterStillIds(character)[0] ??
            (orphanStills ?? []).find(
              (row) => String((row.metadata as Record<string, unknown> | null)?.character_id ?? "") === character.id,
            )?.id;
          const signed = preferred ? signedStills.find((item) => item.id === preferred) : undefined;
          if (preferred && signed) stillsByCharacter.set(character.id, { id: preferred, url: signed.url });
        }
      } catch {
        /* keep whatever we already resolved */
      }
      const voiceRefs = new Map<string, { id: string; url: string }>();
      const voicePreviews = new Map<string, { id: string; url: string }>();
      try {
        const { data: voiceRows } = await supabase
          .from("assets")
          .select("id, kind, mime_type, storage_path, metadata, created_at")
          .eq("series_id", data.series_id)
          .in("kind", ["voice_reference", "voice_preview"])
          .is("deleted_at", null)
          .order("created_at", { ascending: false });
        const signedVoices = await signAssetRows(voiceRows ?? []);
        for (const row of voiceRows ?? []) {
          const characterId = String((row.metadata as Record<string, unknown> | null)?.character_id ?? "");
          if (!characterId) continue;
          const signed = signedVoices.find((item) => item.id === row.id);
          if (!signed) continue;
          const bucket = row.kind === "voice_reference" ? voiceRefs : voicePreviews;
          if (!bucket.has(characterId)) bucket.set(characterId, { id: row.id, url: signed.url });
        }
      } catch {
        /* keep last-good voices on the client */
      }
      const productionReadiness = await seriesReadiness(supabase, data.series_id);
      const productionBlocking = series?.story_bible
        ? productionReadiness.blocking
        : ["The story has not been written yet", ...productionReadiness.blocking];
      return json({
        ...publicProduction(data as ProductionRow, {
          series_title: series?.title,
          poster_tone: series ? seriesPoster(series) : "g1",
          story_bible: series?.story_bible ?? null,
          cover_url: cover?.url ?? null,
        }),
        episodes: episodes ?? [],
        tasks: (tasks ?? []).map((task) => ({
          ...task,
          title: actionLabel(task.action),
          detail: activityDetail(task),
          status_label:
            task.status === "done"
              ? "Done"
              : task.status === "failed" || task.status === "dead_lettered"
                ? "Failed"
                : task.status === "running"
                  ? "Working"
                  : "Queued",
          subject: typeof (task.payload as Record<string, unknown> | null)?.character_id === "string"
            ? String((task.payload as Record<string, unknown>).character_id)
            : null,
        })),
        characters: (characters ?? []).map((character) => {
          const visual = (character.visual_profile ?? {}) as Record<string, unknown>;
          const refs = (visual.visual_reference_asset_ids ?? {}) as Record<string, unknown>;
          const voice = (character.voice_profile ?? {}) as Record<string, unknown>;
          const still = stillsByCharacter.get(character.id);
          const pending = Array.isArray(voice.pending_previews) ? voice.pending_previews : [];
          const spoken =
            character.locked || Boolean(voice.elevenlabs_voice_id)
              ? voiceRefs.get(character.id) ?? voicePreviews.get(character.id)
              : pending.length > 0
                ? voicePreviews.get(character.id)
                : undefined;
          return {
            id: character.id,
            name: character.name,
            description: character.description,
            locked: character.locked,
            still_url: still?.url ?? null,
            voice_url: spoken?.url ?? null,
            still_asset_id: still?.id ?? characterStillIds(character)[0] ?? null,
            voice_asset_id: spoken?.id ?? null,
            has_appearance: Object.keys(refs).length > 0,
            has_voice: Boolean(voice.elevenlabs_voice_id) || (Array.isArray(voice.pending_previews) && voice.pending_previews.length > 0),
          };
        }),
        assets: feed.filter((item) => item.kind === "shot_video"),
        shoots: await productionShoots(supabase, data.series_id, episodes ?? []),
        current_step: (tasks ?? []).find((task) => task.status === "running") ?? (tasks ?? []).find((task) => task.status === "queued") ?? null,
        readiness: {
          ...productionReadiness,
          can_start: Boolean(series?.story_bible) && productionReadiness.can_start,
          blocking: productionBlocking,
        },
        balance: usd(await seriesBalance(supabase, data.series_id)),
        spent: data.status === "awaiting_payment" ? 0 : usd(await seriesSpent(supabase, data.series_id)),
      });
    }

    if (req.method === "POST" && /\/productions\/[^/]+\/pause$/.test(path)) {
      return setPaused(supabase, user.id, path.split("/")[2], true, access.isAdmin);
    }
    if (req.method === "POST" && /\/productions\/[^/]+\/cancel$/.test(path)) {
      return cancelProduction(supabase, user.id, path.split("/")[2], access.isAdmin);
    }
    if (req.method === "POST" && /\/productions\/[^/]+\/resume$/.test(path)) {
      return setPaused(supabase, user.id, path.split("/")[2], false, access.isAdmin);
    }
    if (req.method === "POST" && /\/productions\/[^/]+\/use-best$/.test(path)) {
      return useBest(supabase, user.id, path.split("/")[2], access.isAdmin);
    }
    if (req.method === "POST" && /\/productions\/[^/]+\/approve-pilot$/.test(path)) {
      const production = await loadProduction(supabase, user.id, path.split("/")[2], access.isAdmin);
      if (!production) return json({ error: "Not found" }, 404);
      await supabase
        .from("series")
        .update({ pilot_approved_at: new Date().toISOString() })
        .eq("id", production.series_id);
      return json({ ok: true });
    }
    if (req.method === "POST" && /\/productions\/[^/]+\/confirm-test$/.test(path)) {
      if (!access.isAdmin) return json({ error: "admin_required" }, 403);
      return confirmTestPayment(supabase, user.id, path.split("/")[2]);
    }

    if (req.method === "GET" && path.startsWith("/episodes/")) {
      const parts = path.split("/");
      const id = parts[2];
      const { data: episode } = await supabase.from("episodes").select("*").eq("id", id).maybeSingle();
      if (!episode) return json({ error: "Not found" }, 404);
      const series = await ownedSeries(supabase, user.id, episode.series_id, access.isAdmin);
      if (!series) return json({ error: "Not found" }, 404);
      if (parts[3] === "scenes") {
        const { data: scenes } = await supabase.from("scenes").select("*").eq("episode_id", id).order("position");
        return json({ items: scenes ?? [] });
      }
      if (parts[3] === "shots") {
        const { data: scenes } = await supabase.from("scenes").select("id").eq("episode_id", id);
        const sceneIds = (scenes ?? []).map((row) => row.id);
        const { data: shots } = sceneIds.length
          ? await supabase.from("shots").select("*").in("scene_id", sceneIds).order("position")
          : { data: [] };
        return json({ items: shots ?? [] });
      }
      if (parts[3] === "report") {
        const { count: jobs } = await supabase
          .from("generation_jobs")
          .select("id", { count: "exact", head: true })
          .eq("episode_id", id);
        return json({
          episode_id: id,
          status: episode.status,
          jobs: jobs ?? 0,
          cost: await seriesBalance(supabase, episode.series_id),
        });
      }
      const [{ data: sceneRows }, { data: production }] = await Promise.all([
        supabase.from("scenes").select("*, shots(*)").eq("episode_id", id).order("position"),
        supabase
          .from("productions")
          .select("id, mode, status")
          .eq("series_id", episode.series_id)
          .in("status", ["queued", "running", "needs_user", "ready"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      const scenes = (sceneRows ?? []).map(({ shots: _shots, ...scene }) => scene);
      const sceneOrder = new Map(scenes.map((scene) => [scene.id, scene.position ?? 0]));
      const shots = (sceneRows ?? [])
        .flatMap((row) => row.shots ?? [])
        .sort(
          (left, right) =>
            (sceneOrder.get(left.scene_id) ?? 0) - (sceneOrder.get(right.scene_id) ?? 0) ||
            (left.position ?? 0) - (right.position ?? 0),
        );
      const videoIds = shots
        .map((shot) => shot.selected_generation_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0);
      const { data: videoRows } = videoIds.length
        ? await supabase
            .from("assets")
            .select("id, kind, mime_type, storage_path, metadata, created_at")
            .in("id", videoIds)
            .is("deleted_at", null)
        : { data: [] };
      const signedVideos = await signAssetRows(videoRows ?? []);
      const videoById = new Map(signedVideos.map((item) => [item.id, item.url]));
      const { data: finalRows } = await supabase
        .from("assets")
        .select("id, kind, mime_type, storage_path, metadata, created_at")
        .eq("series_id", episode.series_id)
        .in("kind", ["episode_final", "episode_captions"])
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(12);
      const forEpisode = (kind: string) =>
        (finalRows ?? []).filter(
          (row) =>
            row.kind === kind &&
            String((row.metadata as { episode_id?: string } | null)?.episode_id ?? "") === String(id),
        );
      const signedFinal = await signAssetRows(forEpisode("episode_final").slice(0, 1));
      const signedCaptions = await signAssetRows(forEpisode("episode_captions").slice(0, 1));
      return json({
        ...episode,
        series_title: series.title,
        poster_tone: episode.poster_tone || seriesPoster(series),
        production_id: production?.id ?? null,
        production_mode: production?.mode ?? null,
        final_url: signedFinal[0]?.url ?? null,
        captions_url: signedCaptions[0]?.url ?? null,
        scenes: scenes ?? [],
        shots: (shots ?? []).map((shot) => ({
          ...shot,
          video_url: shot.selected_generation_id ? videoById.get(shot.selected_generation_id) ?? null : null,
        })),
      });
    }

    if (req.method === "GET" && path.startsWith("/shots/")) {
      const id = path.split("/")[2];
      const { data: shot } = await supabase.from("shots").select("*").eq("id", id).maybeSingle();
      if (!shot) return json({ error: "Not found" }, 404);
      const { data: scene } = await supabase.from("scenes").select("*").eq("id", shot.scene_id).maybeSingle();
      if (!scene) return json({ error: "Not found" }, 404);
      const { data: episode } = await supabase.from("episodes").select("*").eq("id", scene.episode_id).maybeSingle();
      if (!episode) return json({ error: "Not found" }, 404);
      const series = await ownedSeries(supabase, user.id, episode.series_id, access.isAdmin);
      if (!series) return json({ error: "Not found" }, 404);
      return json({ ...shot, scene, episode_id: episode.id, series_id: series.id });
    }

    if (req.method === "GET" && path.startsWith("/characters/")) {
      const id = path.split("/")[2];
      const { data } = await supabase.from("characters").select("*").eq("id", id).maybeSingle();
      if (!data) return json({ error: "Not found" }, 404);
      const series = await ownedSeries(supabase, user.id, data.series_id, access.isAdmin);
      if (!series) return json({ error: "Not found" }, 404);
      const pack = await signCharacterPacks(supabase, [data]);
      return json(
        presentPackedCharacter(pack.characters[0] ?? data, pack.signed, {
          series_title: series.title,
          fallback: pack.orphanByCharacter.get(String(data.id)),
        }),
      );
    }

    if (req.method === "POST" && /\/characters\/[^/]+\/cast$/.test(path)) {
      const characterId = path.split("/")[2];
      const body = await req.json().catch(() => ({}));
      const actorId = String(body.actor_id ?? "");
      const { data: character } = await supabase.from("characters").select("*").eq("id", characterId).maybeSingle();
      if (!character) return json({ error: "Not found" }, 404);
      const series = await ownedSeries(supabase, user.id, character.series_id, access.isAdmin);
      if (!series) return json({ error: "Not found" }, 404);
      if (character.locked) return json({ error: "This role is locked" }, 403);
      const { data: actor } = await supabase.from("actors").select("*").eq("id", actorId).eq("owner_id", user.id).maybeSingle();
      if (!actor) return json({ error: "Actor not found" }, 404);
      const visual = {
        ...((character.visual_profile ?? {}) as Record<string, unknown>),
        visual_reference_asset_ids: {
          ...((character.visual_profile as Record<string, unknown> | null)?.visual_reference_asset_ids as Record<string, unknown> ?? {}),
          ...((actor.visual_reference_asset_ids ?? {}) as Record<string, unknown>),
        },
      };
      const { error } = await supabase
        .from("characters")
        .update({ actor_id: actor.id, visual_profile: visual, updated_at: new Date().toISOString() })
        .eq("id", characterId);
      if (error) return json({ error: error.message }, 400);
      const refs = (actor.visual_reference_asset_ids ?? {}) as Record<string, unknown>;
      if (Object.keys(refs).length === 0) {
        await enqueue(supabase, user.id, series.id, "generate_actor", { actor_id: actor.id }, access.isAdmin);
      }
      await enqueue(supabase, user.id, series.id, "generate_wardrobe", { character_id: characterId }, access.isAdmin);
      // Keep the show's cast sheet in step with a role cast from its own page.
      await supabase.from("series_cast").upsert(
        {
          series_id: series.id,
          role_name: String(character.name),
          actor_id: actor.id,
          character_id: characterId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "series_id,role_name" },
      );
      const { data: next } = await supabase.from("characters").select("*").eq("id", characterId).single();
      const pack = await signCharacterPacks(supabase, [next ?? character]);
      return json(presentPackedCharacter(pack.characters[0] ?? next ?? character, pack.signed));
    }

    if (req.method === "POST" && /\/characters\/[^/]+\/generate-appearance$/.test(path)) {
      const body = await req.json().catch(() => ({}));
      return enqueue(supabase, user.id, body.series_id, "generate_appearance", {
        character_id: path.split("/")[2],
      }, access.isAdmin);
    }
    if (req.method === "POST" && /\/characters\/[^/]+\/design-voice$/.test(path)) {
      const body = await req.json().catch(() => ({}));
      return enqueue(supabase, user.id, body.series_id, "design_voice", {
        character_id: path.split("/")[2],
      }, access.isAdmin);
    }
    if (req.method === "POST" && /\/characters\/[^/]+\/lock$/.test(path)) {
      const body = await req.json().catch(() => ({}));
      return enqueue(supabase, user.id, body.series_id, "lock_character", {
        character_id: path.split("/")[2],
        voice_candidate_id: body.voice_candidate_id,
      }, access.isAdmin);
    }

    if (req.method === "POST" && path === "/episodes") {
      const body = await req.json();
      return enqueue(supabase, user.id, body.series_id, "create_episode", {
        episode_number: body.episode_number,
        title: body.title,
      }, access.isAdmin, body.production_id);
    }
    if (req.method === "POST" && /\/episodes\/[^/]+\/plan$/.test(path)) {
      const body = await req.json().catch(() => ({}));
      return enqueue(supabase, user.id, body.series_id, "plan_episode", {
        episode_id: path.split("/")[2],
      }, access.isAdmin, body.production_id);
    }
    if (req.method === "POST" && /\/episodes\/[^/]+\/render$/.test(path)) {
      const body = await req.json().catch(() => ({}));
      return enqueue(supabase, user.id, body.series_id, "render_episode", {
        episode_id: path.split("/")[2],
      }, access.isAdmin, body.production_id);
    }
    if (req.method === "POST" && /\/shots\/[^/]+\/generate-dialogue$/.test(path)) {
      const body = await req.json().catch(() => ({}));
      return enqueue(supabase, user.id, body.series_id, "generate_dialogue", {
        shot_id: path.split("/")[2],
      }, access.isAdmin, body.production_id);
    }
    if (req.method === "POST" && /\/shots\/[^/]+\/generate-video$/.test(path)) {
      const body = await req.json().catch(() => ({}));
      return enqueue(supabase, user.id, body.series_id, "generate_video", {
        shot_id: path.split("/")[2],
      }, access.isAdmin, body.production_id);
    }
    if (req.method === "POST" && /\/shots\/[^/]+\/regenerate$/.test(path)) {
      const body = await req.json().catch(() => ({}));
      return enqueue(supabase, user.id, body.series_id, "regenerate_shot", {
        shot_id: path.split("/")[2],
      }, access.isAdmin, body.production_id);
    }
    // Reviewer decision on a take. Approval pins it, rejection drops it; the
    // episode is re-cut on request, not regenerated.
    if (req.method === "POST" && /\/shots\/[^/]+\/review$/.test(path)) {
      const body = await req.json().catch(() => ({}));
      if (typeof body.asset_id !== "string" || !body.asset_id) return json({ error: "asset_id is required" }, 400);
      if (body.decision !== "approve" && body.decision !== "reject") return json({ error: "decision must be approve or reject" }, 400);
      return enqueue(supabase, user.id, body.series_id, "review_take", {
        shot_id: path.split("/")[2],
        asset_id: body.asset_id,
        decision: body.decision,
        note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
      }, access.isAdmin, body.production_id);
    }
    // Re-cut from the current takes without generating anything.
    if (req.method === "POST" && /\/episodes\/[^/]+\/recut$/.test(path)) {
      const body = await req.json().catch(() => ({}));
      const episodeId = path.split("/")[2];
      const { data: episode } = await supabase.from("episodes").select("id, series_id").eq("id", episodeId).maybeSingle();
      if (!episode) return json({ error: "Not found" }, 404);
      return enqueue(supabase, user.id, episode.series_id, "render_episode", { episode_id: episodeId, recut: true }, access.isAdmin, body.production_id);
    }

    if (req.method === "GET" && path.startsWith("/jobs/")) {
      const id = path.split("/")[2];
      const { data, error } = await supabase
        .from("generation_jobs")
        .select("*")
        .eq("id", id)
        .eq("owner_id", user.id)
        .maybeSingle();
      if (error) return json({ error: error.message }, 400);
      if (!data) return json({ error: "Not found" }, 404);
      return json(data);
    }

    if (req.method === "GET" && path.startsWith("/tasks/")) {
      const id = path.split("/")[2];
      const { data, error } = await supabase
        .from("engine_tasks")
        .select("*")
        .eq("id", id)
        .eq("owner_id", user.id)
        .maybeSingle();
      if (error) return json({ error: error.message }, 400);
      if (!data) return json({ error: "Not found" }, 404);
      return json(data);
    }

    if (req.method === "GET" && path === "/billing") {
      return billingSummary(supabase, user.id, user.email);
    }

    if (req.method === "POST" && path === "/billing/checkout") {
      return createCheckout(req, supabase, user, access.isAdmin);
    }

    if (req.method === "POST" && path === "/billing/portal") {
      return createPortal(req, supabase, user);
    }

    if (req.method === "POST" && path === "/billing/confirm-test") {
      return confirmTestCredit(req, supabase, user.id);
    }

    // Operator health: what is stuck, what gave up, what failed recently. The
    // runner logs the same facts, but a paged operator needs one call.
    if (req.method === "GET" && path === "/ops/health") {
      if (!access.isAdmin) return json({ error: "admin_required" }, 403);
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [stuck, dead, queued, running, recentFailures, pendingVideo] = await Promise.all([
        supabase.from("engine_tasks_stuck").select("*").order("lease_until", { ascending: true }).limit(50),
        supabase.from("engine_tasks").select("id, series_id, production_id, action, attempt, error_code, updated_at").eq("status", "dead_lettered").order("updated_at", { ascending: false }).limit(50),
        supabase.from("engine_tasks").select("id", { count: "exact", head: true }).eq("status", "queued"),
        supabase.from("engine_tasks").select("id", { count: "exact", head: true }).eq("status", "running"),
        supabase.from("job_events").select("kind, status, series_id, task_id, detail, created_at").in("kind", ["task_failed", "task_dead_lettered"]).gte("created_at", since).order("created_at", { ascending: false }).limit(100),
        supabase.from("generation_jobs").select("id, series_id, model, status, updated_at").eq("job_type", "video").in("status", ["queued", "submitting", "generating", "ingesting"]).order("updated_at", { ascending: true }).limit(100),
      ]);
      const oldestPending = pendingVideo.data?.[0]?.updated_at ?? null;
      const alerts: string[] = [];
      if ((stuck.data?.length ?? 0) > 0) alerts.push(`${stuck.data!.length} task(s) hold an expired lease`);
      if ((dead.data?.length ?? 0) > 0) alerts.push(`${dead.data!.length} task(s) dead-lettered`);
      if (oldestPending && Date.now() - Date.parse(oldestPending) > 45 * 60 * 1000) alerts.push("a video job has been pending for over 45 minutes");
      return json({
        ok: alerts.length === 0,
        alerts,
        queue: { queued: queued.count ?? 0, running: running.count ?? 0, pending_video: pendingVideo.data?.length ?? 0, oldest_pending_video_at: oldestPending },
        stuck: stuck.data ?? [],
        dead_lettered: dead.data ?? [],
        recent_failures: recentFailures.data ?? [],
        checked_at: new Date().toISOString(),
      });
    }

    if (req.method === "POST" && path === "/billing/adjust") {
      if (!access.isAdmin) return json({ error: "admin_required" }, 403);
      const body = await req.json();
      const series = await ownedSeries(supabase, body.owner_id ?? user.id, body.series_id, true);
      if (!series) return json({ error: "Not found" }, 404);
      const { data, error } = await supabase
        .from("project_ledger")
        .insert({
          owner_id: series.owner_id,
          series_id: series.id,
          entry_type: "adjustment",
          amount: Number(body.amount),
          price_snapshot_version: PRICE_SNAPSHOT_VERSION,
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 400);
      return json(data, 201);
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error: error instanceof Error ? error.message : "error" }, 500);
  }
});

function displayName(email?: string | null) {
  if (!email) return "";
  const local = email.split("@")[0] ?? "";
  return local.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function productionShoots(
  supabase: ReturnType<typeof serviceClient>,
  seriesId: string,
  episodes: Array<{ id: string; episode_number: number }>,
): Promise<Array<{ id: string; label: string; status: string; episode_number: number | null; shot_position: number; title: string }>> {
  if (episodes.length === 0) return [];
  const episodeIds = episodes.map((episode) => episode.id);
  const { data: scenes } = await supabase.from("scenes").select("id, episode_id, position").in("episode_id", episodeIds);
  const sceneIds = (scenes ?? []).map((row) => row.id);
  if (sceneIds.length === 0) return [];
  const episodeByScene = new Map((scenes ?? []).map((row) => [row.id, row.episode_id]));
  const scenePosition = new Map((scenes ?? []).map((row) => [row.id, row.position ?? 0]));
  const episodeNumber = new Map(episodes.map((episode) => [episode.id, episode.episode_number]));
  const [{ data: shots }, { data: jobs }] = await Promise.all([
    supabase.from("shots").select("id, scene_id, position, status, shot_data").in("scene_id", sceneIds),
    supabase
      .from("generation_jobs")
      .select("shot_id, status")
      .eq("series_id", seriesId)
      .eq("job_type", "video")
      .in("status", ["queued", "submitting", "generating", "ingesting"]),
  ]);
  const busy = new Set((jobs ?? []).map((job) => job.shot_id).filter(Boolean));
  const ordered = [...(shots ?? [])].sort((left, right) => {
    const episodeLeft = episodeNumber.get(episodeByScene.get(left.scene_id) ?? "") ?? 0;
    const episodeRight = episodeNumber.get(episodeByScene.get(right.scene_id) ?? "") ?? 0;
    if (episodeLeft !== episodeRight) return episodeLeft - episodeRight;
    const sceneLeft = scenePosition.get(left.scene_id) ?? 0;
    const sceneRight = scenePosition.get(right.scene_id) ?? 0;
    if (sceneLeft !== sceneRight) return sceneLeft - sceneRight;
    return (left.position ?? 0) - (right.position ?? 0);
  });
  const shotIndex = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const shot of ordered) {
    const episodeId = episodeByScene.get(shot.scene_id) ?? "";
    const next = (seen.get(episodeId) ?? 0) + 1;
    seen.set(episodeId, next);
    shotIndex.set(shot.id, next);
  }
  return ordered.map((shot) => {
      const data = (shot.shot_data ?? {}) as Record<string, unknown>;
      const speaker = typeof data.speaker === "string" ? data.speaker : null;
      const silent = !data.dialogue;
      const episode = episodeNumber.get(episodeByScene.get(shot.scene_id) ?? "") ?? null;
      const position = shotIndex.get(shot.id) ?? shot.position ?? 0;
      const generating = shot.status === "generating" || busy.has(shot.id);
      const status =
        shot.status === "complete"
          ? "complete"
          : shot.status === "needs_review"
            ? "needs_review"
            : generating
              ? "generating"
              : "queued";
      return {
        id: shot.id,
        label: generating
          ? silent
            ? speaker
              ? `Shooting a silent beat · ${speaker}`
              : "Shooting a silent beat"
            : speaker
              ? `Shooting ${speaker}`
              : "Shooting this scene"
          : shot.status === "complete"
            ? "Ready"
            : "Queued",
        status,
        episode_number: episode,
        shot_position: position,
        title: episode ? `Episode ${episode} · Shot ${position}` : `Shot ${position}`,
      };
    });
}

function characterStillIds(character: Record<string, unknown>): string[] {
  return stillAssetIds((character.visual_profile ?? {}) as Record<string, unknown>);
}

function seriesCard(series: Record<string, unknown>, coverUrl?: string | null) {
  return {
    id: series.id,
    title: series.title,
    status: series.status,
    sku: series.sku,
    poster_tone: seriesPoster(series as { id: string; poster_tone?: string | null }),
    cover_url: coverUrl ?? null,
    pilot_approved: Boolean(series.pilot_approved_at),
    created_at: series.created_at,
  };
}

async function coverMap(
  supabase: ReturnType<typeof serviceClient>,
  ids: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  const { data } = await supabase
    .from("assets")
    .select("id, kind, mime_type, storage_path, metadata, created_at")
    .in("id", unique);
  const signed = await signAssetRows(data ?? []);
  return Object.fromEntries(signed.map((item) => [item.id, item.url]));
}

async function attention(supabase: ReturnType<typeof serviceClient>, userId: string) {
  const { data: productions } = await supabase
    .from("productions")
    .select("*")
    .eq("owner_id", userId)
    .neq("status", "cancelled")
    .order("updated_at", { ascending: false })
    .limit(12);
  const live = (productions ?? []).filter(
    (row) => !row.paused && ["needs_user", "queued", "running", "ready"].includes(row.status),
  );
  const seriesIds = [...new Set(live.map((row) => row.series_id))];
  const { data: seriesRows } = seriesIds.length
    ? await supabase.from("series").select("id, title").in("id", seriesIds)
    : { data: [] };
  const titles = Object.fromEntries((seriesRows ?? []).map((row) => [row.id, row.title]));
  const [{ data: busyJobs }, { data: takeRows }] = seriesIds.length
    ? await Promise.all([
        supabase
          .from("generation_jobs")
          .select("series_id")
          .in("series_id", seriesIds)
          .eq("job_type", "video")
          .in("status", ["queued", "submitting", "generating", "ingesting"]),
        supabase
          .from("assets")
          .select("series_id")
          .in("series_id", seriesIds)
          .eq("kind", "shot_video")
          .is("deleted_at", null),
      ])
    : [{ data: [] }, { data: [] }];
  const busySeries = new Set((busyJobs ?? []).map((row) => row.series_id));
  const takeSeries = new Set((takeRows ?? []).map((row) => row.series_id));
  const blocked = live.filter((row) => row.status === "needs_user");
  return json({
    items: blocked.map((row) => {
      const kind = attentionKind(row.intervention_type);
      return {
        id: row.id,
        production_id: row.id,
        series_id: row.series_id,
        series_title: titles[row.series_id] ?? "Series",
        kind,
        title: kind === "technical" ? "This step needs a retry" : kind === "policy" ? "This scene cannot be generated" : kind === "quality" ? "This take needs a decision" : "This production needs you",
        detail: interventionMessage(
          row.intervention_type,
          row.agent_decision,
          typeof (row.intervention as Record<string, unknown> | null)?.message === "string"
            ? String((row.intervention as Record<string, unknown>).message)
            : null,
        ),
        primary_action: kind === "technical" ? "retry" : kind === "quality" ? "use_best" : "open",
        href: `/productions/${row.id}`,
      };
    }),
    activity: live.map((row) => {
      const copy = deskActivity(
        row.status,
        row.ui_phase,
        row.agent_decision,
        busySeries.has(row.series_id),
        takeSeries.has(row.series_id),
      );
      return {
        id: row.id,
        production_id: row.id,
        series_title: titles[row.series_id] ?? "Series",
        ...copy,
        href: `/productions/${row.id}`,
      };
    }),
  });
}

function deskActivity(
  status: string,
  phase: string | null | undefined,
  decision: string | null | undefined,
  busyVideo: boolean,
  hasTakes: boolean,
): { state: "watching" | "issue" | "fixing" | "resolved" | "cutting" | "ready"; title: string; detail: string } {
  if (status === "needs_user") {
    return { state: "issue", title: "Issue appeared", detail: decision ?? "This production needs a decision from you." };
  }
  if (status === "ready") {
    return { state: "ready", title: "Ready to watch", detail: decision ?? "This run is ready to watch." };
  }
  if (/retry|dropped|busy|outage/i.test(String(decision ?? ""))) {
    return { state: "fixing", title: "Fixing issue", detail: decision ?? "Retrying this step on the studio." };
  }
  if (phase === "producing" && !busyVideo && hasTakes) {
    return { state: "cutting", title: "Cutting the episode", detail: decision ?? "Cutting the episode." };
  }
  return { state: "watching", title: "Working now", detail: decision ?? "Production continues on the studio." };
}


async function home(supabase: ReturnType<typeof serviceClient>, userId: string, email?: string) {
  const [{ data: productions }, { data: series }, { data: episodes }] = await Promise.all([
    supabase
      .from("productions")
      .select("*")
      .eq("owner_id", userId)
      .in("status", ["queued", "running", "needs_user", "ready"])
      .order("updated_at", { ascending: false }),
    supabase.from("series").select("*").eq("owner_id", userId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase
      .from("episodes")
      .select("*")
      .eq("status", "complete")
      .order("updated_at", { ascending: false })
      .limit(12),
  ]);
  const seriesById = Object.fromEntries((series ?? []).map((row) => [row.id, row]));
  const covers = await coverMap(supabase, (series ?? []).map((row) => row.cover_asset_id).filter(Boolean));
  const ownedComplete = (episodes ?? []).filter((episode) => seriesById[episode.series_id]);
  const running = (productions ?? []).filter((row) => row.status === "queued" || row.status === "running");
  const blocked = (productions ?? []).find((row) => row.status === "needs_user") as ProductionRow | undefined;
  const latestBySeries = new Map<string, ProductionRow>();
  for (const row of productions ?? []) {
    if (row.status === "ready") continue;
    if (!latestBySeries.has(row.series_id)) latestBySeries.set(row.series_id, row as ProductionRow);
  }
  const inProduction = [...latestBySeries.values()];
  const seriesCount = new Set(running.map((row) => row.series_id)).size;
  const inFlight = running.reduce((sum, row) => sum + (row.episode_end - row.episode_start + 1), 0);
  const statusSentence = running.length
    ? seriesCount === 1
      ? `Shooting ${inFlight} episode${inFlight === 1 ? "" : "s"}`
      : `Shooting ${seriesCount} shows`
    : blocked
      ? "A show needs you"
      : ownedComplete.length
        ? "Nothing is shooting right now"
        : "Commission a show";

  return json({
    display_name: displayName(email),
    status_sentence: statusSentence,
    in_flight_episodes: inFlight,
    blocked: blocked
      ? {
          production_id: blocked.id,
          series_title: seriesById[blocked.series_id]?.title ?? "Series",
          episode: blocked.episode_start,
          type: blocked.intervention_type,
          message: interventionMessage(blocked.intervention_type, blocked.agent_decision),
        }
      : null,
    ready_to_publish: ownedComplete.slice(0, 6).map((episode) => ({
      id: episode.id,
      series_id: episode.series_id,
      series_title: seriesById[episode.series_id]?.title,
      episode_number: episode.episode_number,
      title: episode.title,
      poster_tone: episode.poster_tone || seriesPoster(seriesById[episode.series_id] ?? { id: episode.series_id }),
      cover_url: covers[seriesById[episode.series_id]?.cover_asset_id ?? ""] ?? null,
      duration_seconds: episode.duration_seconds,
      status: episode.status,
      updated_at: episode.updated_at,
    })),
    in_production: inProduction.map((row) =>
      publicProduction(row, {
        series_title: seriesById[row.series_id]?.title ?? "Series",
        poster_tone: seriesPoster(seriesById[row.series_id] ?? { id: row.series_id }),
        cover_url: covers[seriesById[row.series_id]?.cover_asset_id ?? ""] ?? null,
      }),
    ),
    series: (series ?? []).map((row) => seriesCard(row, covers[row.cover_asset_id ?? ""])),
  });
}

async function createProduction(
  req: Request,
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  email: string | undefined,
  isAdmin: boolean,
) {
  const body = await req.json();
  if (!hasExplicitStartConfirmation(body)) {
    return json({ error: "start_confirmation_required", message: "Confirm the final start action before creating a production." }, 409);
  }
  const parsed = parseProductionBody(body);
  if ("error" in parsed && parsed.error) return json({ error: parsed.error }, 400);
  if (!parsed.sku || parsed.sku === "topup" || parsed.sku === "credit") {
    return json({ error: "productions use a block sku" }, 400);
  }

  const verdict = moderateText(`${parsed.title ?? ""}\n${parsed.description ?? ""}`, "story_input");
  if (verdict.verdict === "block") {
    return json({
      error: "content_policy",
      reason: verdict.reason,
      allowed: false,
    }, 422);
  }

  let series = parsed.series_id
    ? await ownedSeries(supabase, userId, parsed.series_id, isAdmin)
    : null;
  if (!series && parsed.title) {
    const { data: titled } = await supabase
      .from("series")
      .select("*")
      .eq("owner_id", userId)
      .eq("title", parsed.title)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    for (const candidate of titled ?? []) {
      const { data: paid } = await supabase
        .from("productions")
        .select("id")
        .eq("series_id", candidate.id)
        .gt("paid_amount", 0)
        .limit(1);
      if ((paid ?? []).length === 0) {
        series = candidate;
        break;
      }
    }
  }
  if (!series) {
    if (!parsed.title) return json({ error: "title is required for a new series" }, 400);
    const created = await supabase
      .from("series")
      .insert({
        owner_id: userId,
        title: parsed.title,
        description: parsed.description,
        target_episode_count: parsed.sku === 2 ? 60 : parsed.sku,
        sku: String(parsed.sku === 2 ? 60 : parsed.sku),
        poster_tone: posterTone(parsed.title),
        style_profile: {
          aspect: "9:16",
          episode_length: parsed.length,
          video_tier: parsed.video_tier,
        },
      })
      .select()
      .single();
    if (created.error || !created.data) return json({ error: created.error?.message ?? "series failed" }, 400);
    series = created.data;
  } else {
    const title = parsed.title ?? series.title;
    const target = parsed.sku === 2 ? (series.target_episode_count ?? 60) : parsed.sku;
    const { data: refreshed } = await supabase
      .from("series")
      .update({
        title,
        description: parsed.description ?? series.description,
        target_episode_count: target,
        sku: String(target),
        style_profile: {
          ...((series.style_profile as Record<string, unknown> | null) ?? {}),
          aspect: "9:16",
          episode_length: parsed.length,
          video_tier: parsed.video_tier,
        },
      })
      .eq("id", series.id)
      .select()
      .single();
    if (refreshed) series = refreshed;
  }

  if (parsed.cover_base64) {
    await supabase.from("engine_tasks").insert({
      owner_id: userId,
      series_id: series.id,
      action: "attach_cover",
      payload: { cover_base64: parsed.cover_base64, cover_mime_type: parsed.cover_mime_type ?? "image/jpeg" },
      status: "queued",
    });
  }

  if (parsed.script_text) {
    // Stored now so `segment_script` can read it back after the bible exists.
    await supabase.from("engine_tasks").insert({
      owner_id: userId,
      series_id: series.id,
      action: "attach_script",
      payload: { script_text: parsed.script_text },
      status: "queued",
    });
  }

  /**
   * Nothing is shot until every face, place and object exists.
   *
   * Anything still missing gets invented mid-run, and an invented thing is a
   * different thing each time it appears: another penthouse in episode 4, a
   * contract that does not match episode 1's. The buyer approves all three
   * first. A series created in this same request has no slate to check yet, so
   * this only bites once one exists — which is every show opened from the app.
   */
  const readiness = await seriesReadiness(supabase, series.id);
  const blocking = series.story_bible ? readiness.blocking : ["The story has not been written yet", ...readiness.blocking];
  if (!series.story_bible || !readiness.can_start) {
    return json(
      {
        error: "not_ready",
        message: `This show is not ready to shoot. ${blocking.join(". ")}.`,
        series_id: series.id,
        readiness: { ...readiness, can_start: false, blocking },
      },
      409,
    );
  }

  const { data: unpaid } = await supabase
    .from("productions")
    .select("*")
    .eq("series_id", series.id)
    .eq("status", "awaiting_payment")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let created;
  if (unpaid && Number((unpaid as ProductionRow).paid_amount ?? 0) <= 0) {
    const { data: synced } = await supabase
      .from("productions")
      .update({
        sku: String(parsed.sku),
        priority: parsed.priority,
        episode_length: parsed.length,
        video_tier: parsed.video_tier,
        mode: parsed.mode,
        notify: parsed.notify,
        updated_at: new Date().toISOString(),
      })
      .eq("id", (unpaid as ProductionRow).id)
      .select()
      .single();
    created = {
      production: (synced ?? unpaid) as ProductionRow,
      estimate: estimateBlock({
        sku: parsed.sku,
        priority: parsed.priority,
        length: parsed.length,
        video_tier: parsed.video_tier,
      }),
    };
  } else {
    created = await createProductionRecord(supabase, {
      ownerId: userId,
      series,
      mode: parsed.mode,
      sku: parsed.sku,
      priority: parsed.priority,
      length: parsed.length,
      notify: parsed.notify,
      video_tier: parsed.video_tier,
    });
  }
  if ("error" in created && created.error) return json({ error: created.error }, created.status);

  const needed = created.estimate.retail;
  const available = await walletBalance(supabase, userId);
  if (available + 1e-9 >= needed) {
    const allocated = await allocateWalletToSeries(supabase, {
      ownerId: series.owner_id,
      seriesId: series.id,
      productionId: created.production.id,
      amount: needed,
    });
    if ("error" in allocated) return json({ error: allocated.error }, 400);
    const { data, error } = await supabase
      .from("productions")
      .update({
        status: "queued",
        ui_phase: "preparing",
        paid_amount: needed,
        updated_at: new Date().toISOString(),
      })
      .eq("id", created.production.id)
      .select()
      .single();
    if (error || !data) return json({ error: error?.message ?? "Could not start the run" }, 400);
    await supabase.from("engine_tasks").insert({
      owner_id: data.owner_id,
      series_id: data.series_id,
      production_id: data.id,
      action: "advance_production",
      payload: { production_id: data.id },
      status: "queued",
    });
    await wakeJobs();
    return json(
      publicProduction(data as ProductionRow, {
        series_title: series.title,
        poster_tone: seriesPoster(series),
        paid_from: "wallet",
      }),
      201,
    );
  }

  return json(
    {
      error: "insufficient_credit",
      needed,
      available,
      shortfall: Math.max(0, Math.round((needed - available) * 100) / 100),
      production: publicProduction(created.production, {
        series_title: series.title,
        poster_tone: seriesPoster(series),
      }),
    },
    402,
  );
}

async function loadProduction(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  id: string,
  isAdmin: boolean,
) {
  const { data } = await supabase.from("productions").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  if (data.owner_id !== userId && !isAdmin) return null;
  return data as ProductionRow;
}

async function setPaused(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  id: string,
  paused: boolean,
  isAdmin: boolean,
) {
  const production = await loadProduction(supabase, userId, id, isAdmin);
  if (!production) return json({ error: "Not found" }, 404);
  const status = paused
    ? production.status
    : production.status === "awaiting_payment"
      ? production.status
      : "queued";
  const { data, error } = await supabase
    .from("productions")
    .update({
      paused,
      status,
      ...(paused
        ? {}
        : {
            intervention_type: null,
            intervention: {},
            ui_phase: production.status === "awaiting_payment" ? production.ui_phase : "preparing",
            agent_decision: "Production resumed. Continuing from the last finished step.",
          }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
  if (error) return json({ error: error.message }, 400);
  if (!paused && data.status === "queued") {
    await supabase.from("engine_tasks").insert({
      owner_id: data.owner_id,
      series_id: data.series_id,
      production_id: data.id,
      action: "advance_production",
      payload: { production_id: data.id },
      status: "queued",
    });
    await wakeJobs();
  }
  return json(publicProduction(data as ProductionRow));
}

/**
 * Cancel stops new work: queued tasks for the production are cancelled and the
 * production is marked cancelled. Takes already generated stay on the series
 * and unused credit stays on the ledger for the next production. A running
 * task finishes its current step (its lease is short) and the runner will not
 * advance a cancelled production.
 */
async function cancelProduction(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  id: string,
  isAdmin: boolean,
) {
  const production = await loadProduction(supabase, userId, id, isAdmin);
  if (!production) return json({ error: "Not found" }, 404);
  if (production.status === "ready" || production.status === "cancelled") {
    return json({ error: `Production is already ${production.status}` }, 409);
  }
  const now = new Date().toISOString();
  await supabase
    .from("engine_tasks")
    .update({ status: "cancelled", error_code: "cancelled_by_user", lease_until: null, updated_at: now })
    .eq("production_id", id)
    .in("status", ["queued", "running"]);
  const { data, error } = await supabase
    .from("productions")
    .update({
      status: "cancelled",
      paused: true,
      ui_phase: "cancelled",
      intervention_type: null,
      intervention: {},
      agent_decision: "Production cancelled. Finished takes stay on the show; unused credit stays on your balance.",
      updated_at: now,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) return json({ error: error.message }, 400);
  return json(publicProduction(data as ProductionRow));
}

async function useBest(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  id: string,
  isAdmin: boolean,
) {
  const production = await loadProduction(supabase, userId, id, isAdmin);
  if (!production) return json({ error: "Not found" }, 404);
  if (production.intervention_type === "content_policy") {
    return json({ error: "Policy stops cannot be resolved with Use best." }, 409);
  }
  const { data: episodes } = await supabase.from("episodes").select("id").eq("series_id", production.series_id);
  const episodeIds = (episodes ?? []).map((row) => row.id);
  if (episodeIds.length) {
    const { data: scenes } = await supabase.from("scenes").select("id").in("episode_id", episodeIds);
    const sceneIds = (scenes ?? []).map((row) => row.id);
    if (sceneIds.length) {
      const [{ data: shots }, { data: jobs }] = await Promise.all([
        supabase.from("shots").select("id, status, selected_generation_id").in("scene_id", sceneIds),
        supabase
          .from("generation_jobs")
          .select("shot_id, result_metadata, updated_at")
          .eq("series_id", production.series_id)
          .eq("job_type", "video")
          .order("updated_at", { ascending: true }),
      ]);
      const takes = new Map<string, string>();
      for (const job of jobs ?? []) {
        const assetId = (job.result_metadata as Record<string, unknown> | null)?.asset_id;
        if (job.shot_id && typeof assetId === "string" && assetId) takes.set(job.shot_id, assetId);
      }
      for (const shot of shots ?? []) {
        const take = shot.selected_generation_id || takes.get(shot.id);
        if (!take) continue;
        if (shot.status === "needs_review" || !shot.selected_generation_id) {
          await supabase.from("shots").update({ status: "complete", selected_generation_id: take }).eq("id", shot.id);
        }
      }
    }
  }
  const { data, error } = await supabase
    .from("productions")
    .update({
      status: "queued",
      ui_phase: "producing",
      intervention_type: null,
      intervention: {},
      agent_decision: "Best take used. Production resumed.",
      paused: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
  if (error) return json({ error: error.message }, 400);
  await supabase.from("engine_tasks").insert({
    owner_id: data.owner_id,
    series_id: data.series_id,
    production_id: data.id,
    action: "advance_production",
    payload: { production_id: data.id, use_best: true },
    status: "queued",
  });
  await wakeJobs();
  return json(publicProduction(data as ProductionRow));
}

async function confirmTestPayment(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  id: string,
) {
  const production = await loadProduction(supabase, userId, id, true);
  if (!production) return json({ error: "Not found" }, 404);
  if (production.status !== "awaiting_payment") return json(publicProduction(production));
  const [{ data: series }, readiness] = await Promise.all([
    supabase.from("series").select("story_bible").eq("id", production.series_id).maybeSingle(),
    seriesReadiness(supabase, production.series_id),
  ]);
  const blocking = series?.story_bible ? readiness.blocking : ["The story has not been written yet", ...readiness.blocking];
  if (!series?.story_bible || !readiness.can_start) {
    return json(
      {
        error: "not_ready",
        message: `This show is not ready to shoot. ${blocking.join(". ")}.`,
        readiness: { ...readiness, can_start: false, blocking },
      },
      409,
    );
  }
  const amount = retailForBlock(
    Number(production.sku) as BlockSku,
    production.priority as ProductionPriority,
    production.episode_length as EpisodeLength,
    production.video_tier === "catalog" ? "catalog" : "pro",
  );
  const purchase = await supabase.from("project_ledger").insert({
    owner_id: production.owner_id,
    series_id: production.series_id,
    entry_type: "purchase",
    amount,
    stripe_event_id: `test_${production.id}`,
    price_snapshot_version: PRICE_SNAPSHOT_VERSION,
  });
  if (purchase.error && purchase.error.code !== "23505") return json({ error: purchase.error.message }, 400);
  const { data, error } = await supabase
    .from("productions")
    .update({
      status: "queued",
      ui_phase: "preparing",
      paid_amount: amount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "awaiting_payment")
    .select()
    .single();
  if (error) return json({ error: error.message }, 400);
  await supabase.from("engine_tasks").insert({
    owner_id: production.owner_id,
    series_id: production.series_id,
    production_id: production.id,
    action: "advance_production",
    payload: { production_id: production.id },
    status: "queued",
  });
  await wakeJobs();
  return json(publicProduction(data as ProductionRow));
}

function safeAppPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("://")) return null;
  if (value.includes("\\") || value.includes("\n") || value.includes("\r")) return null;
  return value;
}

async function createCheckout(
  req: Request,
  supabase: ReturnType<typeof serviceClient>,
  user: { id: string; email?: string | null },
  isAdmin: boolean,
) {
  const body = await req.json();
  if (!isCatalogSku(body.sku)) return json({ error: "sku must be 2|12|15|24|30|45|50|60|90|topup|credit" }, 400);
  const walletLoad = body.sku === "credit" || (body.sku === "topup" && !body.series_id);
  if (walletLoad) {
    const amount = Number(body.amount ?? SEASON_PRICES_USD.topup);
    if (!Number.isFinite(amount) || amount < 10 || amount > 20_000) {
      return json({ error: "amount must be between 10 and 20000" }, 400);
    }
    const checkout = await stripeCheckout({
      supabase,
      userId: user.id,
      email: typeof body.email === "string" && body.email.includes("@") ? body.email : user.email,
      series: null,
      production: null,
      sku: body.sku === "credit" ? "credit" : "topup",
      amount: Math.round(amount),
      origin: req.headers.get("origin") ?? "http://127.0.0.1:43123",
      successPath: safeAppPath(body.success_path) ?? "/account/billing",
      cancelPath: safeAppPath(body.cancel_path) ?? safeAppPath(body.success_path) ?? "/account/billing",
    });
    if (!checkout.ok) return json({ error: checkout.error }, checkout.status);
    return json({ id: checkout.id, url: checkout.url }, 201);
  }
  const series = await ownedSeries(supabase, user.id, body.series_id, isAdmin);
  if (!series) return json({ error: "Series not found" }, 404);
  const videoTier = isVideoTier(body.video_tier) ? body.video_tier : "pro";
  const amount = body.sku === "topup"
    ? SEASON_PRICES_USD.topup
    : retailForBlock(
        body.sku,
        isPriority(body.priority) ? body.priority : "balanced",
        isEpisodeLength(body.episode_length) ? body.episode_length : "60_90",
        videoTier,
      );
  const checkout = await stripeCheckout({
    supabase,
    userId: user.id,
    email: typeof body.email === "string" && body.email.includes("@") ? body.email : user.email,
    series,
    production: body.production_id ? { id: body.production_id } : null,
    sku: body.sku,
    amount,
    origin: req.headers.get("origin") ?? "http://127.0.0.1:43123",
  });
  if (!checkout.ok) return json({ error: checkout.error }, checkout.status);
  return json({ id: checkout.id, url: checkout.url }, 201);
}

async function stripeCheckout(input: {
  supabase: ReturnType<typeof serviceClient>;
  userId: string;
  email?: string | null;
  series: { id: string; owner_id: string } | null;
  production: { id: string } | null;
  sku: string | number;
  amount: number;
  origin: string;
  successPath?: string;
  cancelPath?: string;
}): Promise<{ ok: true; id: string; url: string } | { ok: false; error: string; status: number }> {
  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!secret) return { ok: false, error: "Stripe is not configured", status: 500 };
  if (stripeLiveBlocked(secret)) {
    return { ok: false, error: "Live Stripe is blocked until the legal entity is complete", status: 503 };
  }
  const customerId = await ensureStripeCustomer(input.supabase, secret, input.userId, input.email);
  const wallet = !input.series;
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set(
    "success_url",
    input.successPath
      ? `${input.origin}${input.successPath}`
      : input.production
        ? `${input.origin}/productions/${input.production.id}?checkout=success`
        : `${input.origin}/productions?checkout=success`,
  );
  params.set(
    "cancel_url",
    input.cancelPath
      ? `${input.origin}${input.cancelPath}`
      : wallet
        ? `${input.origin}/account/billing`
        : `${input.origin}/new?checkout=cancel`,
  );
  params.set("client_reference_id", input.production?.id ?? input.series?.id ?? input.userId);
  params.set("metadata[owner_id]", input.series?.owner_id ?? input.userId);
  params.set("metadata[sku]", String(input.sku));
  if (input.series) params.set("metadata[series_id]", input.series.id);
  if (input.production) params.set("metadata[production_id]", input.production.id);
  params.set("payment_intent_data[metadata][owner_id]", input.series?.owner_id ?? input.userId);
  params.set("payment_intent_data[metadata][sku]", String(input.sku));
  if (input.series) params.set("payment_intent_data[metadata][series_id]", input.series.id);
  if (input.production) params.set("payment_intent_data[metadata][production_id]", input.production.id);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][unit_amount]", String(Math.round(input.amount * 100)));
  params.set(
    "line_items[0][price_data][product_data][name]",
    input.sku === "credit" || (input.sku === "topup" && wallet)
      ? "Studio credit"
      : input.sku === "topup"
        ? "Season top-up"
        : input.sku === 2 || input.sku === "2"
          ? "2-episode pilot"
          : `${input.sku}-episode run`,
  );
  if (customerId) params.set("customer", customerId);

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const session = await response.json();
  if (!response.ok) return { ok: false, error: session.error?.message ?? "Stripe checkout failed", status: 400 };
  return { ok: true, id: session.id, url: session.url };
}

async function ensureStripeCustomer(
  supabase: ReturnType<typeof serviceClient>,
  secret: string,
  userId: string,
  email?: string | null,
): Promise<string | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.stripe_customer_id) return profile.stripe_customer_id;
  if (!email) return null;

  const params = new URLSearchParams();
  params.set("email", email);
  params.set("metadata[owner_id]", userId);
  const response = await fetch("https://api.stripe.com/v1/customers", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const customer = await response.json();
  if (!response.ok || !customer.id) return null;
  await supabase
    .from("profiles")
    .update({ stripe_customer_id: customer.id, updated_at: new Date().toISOString() })
    .eq("id", userId);
  return customer.id;
}

async function createPrivacyRequest(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim();
  const type = String(body.type ?? "access");
  if (!email || !email.includes("@")) return json({ error: "email required" }, 400);

  let userId: string | null = null;
  try {
    const gated = await requireAccess(req);
    userId = gated.user.id;
  } catch {
    userId = null;
  }

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("privacy_requests")
    .insert({
      user_id: userId,
      email,
      type,
      status: "received",
    })
    .select()
    .single();
  if (error) return json({ error: error.message }, 400);
  return json({ id: data.id, status: data.status }, 201);
}

function stripeLiveBlocked(secret: string) {
  const test = secret.startsWith("sk_test_") || secret.startsWith("rk_test_");
  if (test) return false;
  return Deno.env.get("LEGAL_ENTITY_COMPLETE") !== "1";
}

async function recordAcceptances(
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  req: Request,
  context: string,
) {
  const rows = Object.entries(DOCUMENT_VERSIONS).map(([document_type, version]) => ({
    user_id: userId,
    document_type,
    version,
    context,
    user_agent_summary: req.headers.get("user-agent")?.slice(0, 180) ?? null,
  }));
  const { error } = await supabase.from("legal_acceptances").upsert(rows, { onConflict: LEGAL_ACCEPTANCE_CONFLICT });
  const problem = acceptanceWriteError(error?.message);
  if (problem) return json({ error: problem }, 500);
  return json({ ok: true, accepted: Object.keys(DOCUMENT_VERSIONS) });
}

async function createSignup(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email.includes("@")) return json({ error: "email required" }, 400);
  if (password.length < 8) return json({ error: "Use at least 8 characters" }, 400);
  await requireTurnstile(req, body.turnstile_token, "signup");

  const supabase = serviceClient();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    const duplicate = /already/i.test(error?.message ?? "");
    return json({ error: duplicate ? "An account with that email already exists" : (error?.message ?? "Could not create account") }, 400);
  }
  if (body.accept) {
    const recorded = await recordAcceptances(supabase, data.user.id, req, "signup");
    if (!recorded.ok) return recorded;
  }
  return json({ ok: true }, 201);
}

async function createRecover(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) return json({ error: "email required" }, 400);
  await requireTurnstile(req, body.turnstile_token, "reset");
  const origin = req.headers.get("origin") ?? "http://127.0.0.1:43123";
  const supabase = serviceClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/login?mode=update`,
  });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

async function billingSummary(supabase: ReturnType<typeof serviceClient>, userId: string, email?: string | null) {
  const [{ count }, { data: purchases }, { data: profile }, { data: seriesRows }] = await Promise.all([
    supabase
      .from("productions")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", userId)
      .in("status", ["queued", "running", "needs_user"]),
    supabase
      .from("project_ledger")
      .select("id, amount, series_id, created_at")
      .eq("owner_id", userId)
      .eq("entry_type", "purchase")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("profiles").select("stripe_customer_id").eq("id", userId).maybeSingle(),
    supabase
      .from("series")
      .select("id, title, target_episode_count, sku, style_profile")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const titles = new Map((seriesRows ?? []).map((row) => [String(row.id), String(row.title)]));
  const series = (seriesRows ?? []).map((row) => {
    const profile = (row.style_profile as { episode_length?: string; video_tier?: string } | null) ?? {};
    const target = Number(row.target_episode_count ?? row.sku ?? 30);
    return {
      id: row.id,
      title: row.title,
      target_episode_count: Number.isFinite(target) && target > 0 ? target : 30,
      episode_length: isEpisodeLength(profile.episode_length) ? profile.episode_length : "60_90",
      video_tier: isVideoTier(profile.video_tier) ? profile.video_tier : "pro",
      started: false,
    };
  });
  if (series.length) {
    const { data: paidRows } = await supabase
      .from("productions")
      .select("series_id")
      .in(
        "series_id",
        series.map((row) => row.id),
      )
      .gt("paid_amount", 0);
    const startedIds = new Set((paidRows ?? []).map((row) => String(row.series_id)));
    for (const row of series) row.started = startedIds.has(row.id);
  }
  const receipts = (purchases ?? []).map((row) => ({
    id: row.id,
    amount: usd(row.amount),
    created_at: row.created_at,
    series_id: row.series_id,
    series_title: titles.get(String(row.series_id)) ?? null,
  }));
  return json({
    email: email ?? "",
    slots_used: count ?? 0,
    slots_total: 4,
    stripe_customer_id: profile?.stripe_customer_id ?? null,
    last_payment: receipts[0] ?? null,
    receipts,
    series,
    credit_balance: await walletBalance(supabase, userId),
    credit_presets: [...CREDIT_PRESETS],
    skus: [15, 30, 45, 60, 90].map((sku) => estimateBlock({ sku })),
    topup: estimateBlock({ sku: "topup" }),
  });
}

async function createPortal(
  req: Request,
  supabase: ReturnType<typeof serviceClient>,
  user: { id: string; email?: string | null },
) {
  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!secret) return json({ error: "Stripe is not configured" }, 500);
  if (stripeLiveBlocked(secret)) {
    return json({ error: "Live Stripe is blocked until the legal entity is complete" }, 503);
  }
  const customerId = await ensureStripeCustomer(supabase, secret, user.id, user.email);
  if (!customerId) return json({ error: "No Stripe customer yet. Pay once first." }, 400);
  const origin = req.headers.get("origin") ?? "http://127.0.0.1:43123";
  const params = new URLSearchParams();
  params.set("customer", customerId);
  params.set("return_url", `${origin}/account/billing`);
  const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  const session = await response.json();
  if (!response.ok) return json({ error: session.error?.message ?? "Could not open the billing portal" }, 400);
  return json({ url: session.url });
}

async function confirmTestCredit(
  req: Request,
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
) {
  const secret = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const test = !secret || secret.startsWith("sk_test_") || secret.startsWith("rk_test_");
  if (!test) return json({ error: "Test credit is only available with Stripe test keys" }, 403);
  const body = await req.json().catch(() => ({}));
  const amount = Math.round(Number(body.amount ?? 0));
  if (!Number.isFinite(amount) || amount < 10 || amount > 20_000) {
    return json({ error: "amount must be between 10 and 20000" }, 400);
  }
  const eventId = `test_wallet_${userId}_${Date.now()}`;
  const { error } = await supabase.from("project_ledger").insert({
    owner_id: userId,
    series_id: null,
    entry_type: "purchase",
    amount,
    stripe_event_id: eventId,
    price_snapshot_version: PRICE_SNAPSHOT_VERSION,
  });
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true, credit_balance: await walletBalance(supabase, userId), amount });
}

function storyIdeaInput(body: Record<string, unknown>): StoryIdeaInput {
  return {
    hint: String(body.hint ?? ""),
    category: String(body.category ?? "surprise"),
    lead: String(body.lead ?? ""),
    opposite: String(body.opposite ?? ""),
    setting: String(body.setting ?? ""),
    episode_count: Number(body.episode_count ?? 0),
    episode_length: String(body.episode_length ?? ""),
  };
}

function launchStoryGeneration(
  supabase: ReturnType<typeof serviceClient>,
  ownerId: string,
  generationId: string,
) {
  const promise = runStoryGeneration(supabase, ownerId, generationId);
  const runtime = (globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil: (work: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (runtime) runtime.waitUntil(promise);
  else void promise;
}

async function runStoryGeneration(
  supabase: ReturnType<typeof serviceClient>,
  ownerId: string,
  generationId: string,
) {
  const { data: queued } = await supabase
    .from("story_generations")
    .select("id, input, attempt")
    .eq("id", generationId)
    .eq("owner_id", ownerId)
    .eq("status", "queued")
    .maybeSingle();
  if (!queued) return;

  const { data: claimed } = await supabase
    .from("story_generations")
    .update({
      status: "running",
      attempt: Number(queued.attempt ?? 0) + 1,
      error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", generationId)
    .eq("owner_id", ownerId)
    .eq("status", "queued")
    .select("id")
    .maybeSingle();
  if (!claimed) return;

  let lastWrite = 0;
  let lastTitle = "";
  let lastBrief = "";
  try {
    const idea = await generateStoryIdea((queued.input ?? {}) as StoryIdeaInput, async (progress) => {
      const now = Date.now();
      if (progress.title === lastTitle && progress.brief === lastBrief) return;
      if (now - lastWrite < 120 && progress.brief.length > 0) return;
      lastWrite = now;
      lastTitle = progress.title;
      lastBrief = progress.brief;
      await supabase
        .from("story_generations")
        .update({
          partial_title: progress.title,
          partial_brief: progress.brief,
          updated_at: new Date(now).toISOString(),
        })
        .eq("id", generationId)
        .eq("owner_id", ownerId)
        .eq("status", "running");
    });
    await supabase
      .from("story_generations")
      .update({
        status: "completed",
        partial_title: idea.title,
        partial_brief: idea.brief,
        title: idea.title,
        brief: idea.brief,
        category: idea.category,
        error: null,
        updated_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq("id", generationId)
      .eq("owner_id", ownerId)
      .eq("status", "running");
  } catch (error) {
    await supabase
      .from("story_generations")
      .update({
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 500) : "Could not write a brief",
        updated_at: new Date().toISOString(),
      })
      .eq("id", generationId)
      .eq("owner_id", ownerId)
      .eq("status", "running");
  }
}

function streamStoryGeneration(
  request: Request,
  supabase: ReturnType<typeof serviceClient>,
  ownerId: string,
  generationId: string,
): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  request.signal.addEventListener("abort", () => {
    cancelled = true;
  }, { once: true });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let seen = "";
      try {
        while (!cancelled) {
          const { data, error } = await supabase
            .from("story_generations")
            .select("id, status, partial_title, partial_brief, title, brief, category, error, attempt, updated_at")
            .eq("id", generationId)
            .eq("owner_id", ownerId)
            .maybeSingle();
          if (error || !data) {
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: error?.message ?? "Story generation not found" })}\n\n`));
            break;
          }
          const snapshot = JSON.stringify(data);
          if (snapshot !== seen) {
            seen = snapshot;
            controller.enqueue(encoder.encode(`event: progress\ndata: ${snapshot}\n\n`));
          }
          if (data.status === "completed" || data.status === "failed") break;
          await new Promise((resolve) => setTimeout(resolve, 160));
        }
      } catch {
        // A browser disconnect only closes this subscriber. The waitUntil task
        // keeps writing the generation, and a refreshed page reconnects by id.
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "access-control-allow-origin": "*",
    },
  });
}
