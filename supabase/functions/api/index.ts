import { json, requireAccess, serviceClient } from "../_shared/auth.ts";
import { moderateText } from "../_shared/moderation.ts";
import {
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
  type ProductionRow,
} from "../_shared/productions.ts";
import { generateStoryIdea, STORY_DIRECTIONS } from "../_shared/story-idea.ts";
import { firstOwnedSeriesId, presentActor, signActorPacks } from "../_shared/actors.ts";
import { presentPackedCharacter, signCharacterPacks } from "../_shared/characters.ts";
import { LIKENESS_RIGHTS_VERSION, likenessGate } from "../_shared/likeness.ts";
import { actionLabel, activityDetail, attentionKind, interventionMessage, seriesNextAction, sortShotVideoRows, stillAssetIds, usd } from "../_shared/present.ts";
import { wakeJobs } from "../_shared/jobs.ts";
import { signAssetRows } from "../_shared/sign.ts";
import {
  estimateBlock,
  isCatalogSku,
  isEpisodeLength,
  isPriority,
  isSeasonSku,
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
          "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
        },
      });
    }

    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, "") || "/";

    if (req.method === "GET" && path === "/health") {
      return json({ ok: true, phase: "drama-space", product: "Drama Space" });
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

    const { supabase, user, access } = await requireAccess(req);

    if (req.method === "GET" && path === "/story-ideas/directions") {
      return json({ items: STORY_DIRECTIONS });
    }

    if (req.method === "POST" && path === "/story-ideas") {
      const body = await req.json().catch(() => ({}));
      try {
        const idea = await generateStoryIdea({
          hint: String(body.hint ?? ""),
          category: String(body.category ?? "surprise"),
        });
        return json(idea);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not write a brief";
        const policy = error instanceof Error && error.name === "PolicyError";
        return json({ error: message, reason: message }, policy ? 422 : 502);
      }
    }

    if (req.method === "GET" && path === "/me") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, stripe_customer_id")
        .eq("id", user.id)
        .maybeSingle();
      return json({
        id: user.id,
        email: user.email,
        display_name: displayName(user.email),
        role: access.role,
        beta: access.beta,
        is_admin: access.isAdmin,
        stripe_customer_id: profile?.stripe_customer_id ?? null,
      });
    }

    if (req.method === "POST" && path === "/me/accept") {
      return json({ ok: true });
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
      });
    }

    if (req.method === "GET" && path === "/actors") {
      const { data, error } = await supabase.from("actors").select("*").eq("owner_id", user.id).order("created_at");
      if (error) return json({ error: error.message }, 400);
      const signed = await signActorPacks(supabase, data ?? []);
      return json({ items: (data ?? []).map((row) => presentActor(row, signed)) });
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
      return json({
        ...presentActor(data, signed),
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
      const { data: actor, error } = await supabase
        .from("actors")
        .insert({
          owner_id: user.id,
          name,
          source: seed ? "likeness" : "generated",
          appearance_profile: { default_wardrobe: "", description },
        })
        .select("*")
        .single();
      if (error || !actor) return json({ error: error?.message ?? "Could not create actor" }, 400);
      if (seed) {
        const { error: acceptError } = await supabase.from("legal_acceptances").insert({
          user_id: user.id,
          document_type: "likeness_rights",
          version: LIKENESS_RIGHTS_VERSION,
          context: "actor_upload",
        });
        if (acceptError) return json({ error: acceptError.message }, 400);
      }
      const host = await firstOwnedSeriesId(supabase, user.id, access.isAdmin);
      if (host) {
        await enqueue(supabase, user.id, host, "generate_actor", {
          actor_id: actor.id,
          seed_base64: seed || undefined,
          seed_mime_type: body.seed_mime_type,
        }, access.isAdmin);
      }
      return json(presentActor(actor, new Map()), seed || host ? 202 : 201);
    }

    if (req.method === "GET" && path === "/estimate") {
      const sku = Number(url.searchParams.get("sku") ?? url.searchParams.get("episodes"));
      const priority = url.searchParams.get("priority") ?? "balanced";
      const length = url.searchParams.get("length") ?? "60_90";
      if (!isSeasonSku(sku)) return json({ error: "sku must be 2|12|24|45|60" }, 400);
      if (!isPriority(priority) || !isEpisodeLength(length)) {
        return json({ error: "priority or length is invalid" }, 400);
      }
      return json(estimateBlock({ sku, priority, length }));
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
      const sku = body.sku ?? body.target_episode_count ?? 60;
      if (sku != null && !isSeasonSku(sku) && Number(sku) !== 60) {
        return json({ error: "sku must be 2|12|24|45|60" }, 400);
      }
      const target = isSeasonSku(sku) ? sku : 60;
      const { data, error } = await supabase
        .from("series")
        .insert({
          owner_id: user.id,
          title: body.title,
          description: body.description ?? "",
          target_episode_count: target,
          sku: String(target),
          poster_tone: posterTone(String(body.title ?? user.id)),
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 400);
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
          paid: next.next_action !== "pay_pilot",
          next_action: next.next_action,
          active_production_id: next.active_production_id,
        });
      }
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
        .update({ pilot_approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
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
        .eq("series_id", data.series_id)
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
        balance: usd(await seriesBalance(supabase, data.series_id)),
        spent: usd(await seriesSpent(supabase, data.series_id)),
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
        .eq("kind", "episode_final")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(4);
      const finalForEpisode = (finalRows ?? []).filter(
        (row) => String((row.metadata as { episode_id?: string } | null)?.episode_id ?? "") === String(id),
      );
      const signedFinal = await signAssetRows(finalForEpisode.slice(0, 1));
      return json({
        ...episode,
        series_title: series.title,
        poster_tone: episode.poster_tone || seriesPoster(series),
        production_id: production?.id ?? null,
        production_mode: production?.mode ?? null,
        final_url: signedFinal[0]?.url ?? null,
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

    if (req.method === "POST" && path === "/billing/checkout") {
      return createCheckout(req, supabase, user.id, access.isAdmin);
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
        : "Start a 2-episode pilot";

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
  const parsed = parseProductionBody(body);
  if ("error" in parsed && parsed.error) return json({ error: parsed.error }, 400);
  if (!parsed.sku || parsed.sku === "topup") return json({ error: "productions use a block sku" }, 400);

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
      })
      .select()
      .single();
    if (created.error || !created.data) return json({ error: created.error?.message ?? "series failed" }, 400);
    series = created.data;
  }

  const { data: unpaid } = await supabase
    .from("productions")
    .select("*")
    .eq("series_id", series.id)
    .eq("status", "awaiting_payment")
    .eq("sku", String(parsed.sku))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const created = unpaid
    ? {
        production: unpaid as ProductionRow,
        estimate: estimateBlock({
          sku: parsed.sku,
          priority: parsed.priority,
          length: parsed.length,
        }),
      }
    : await createProductionRecord(supabase, {
        ownerId: userId,
        series,
        mode: parsed.mode,
        sku: parsed.sku,
        priority: parsed.priority,
        length: parsed.length,
        notify: parsed.notify,
      });
  if ("error" in created && created.error) return json({ error: created.error }, created.status);

  const checkout = await stripeCheckout({
    supabase,
    userId,
    email: parsed.email ?? email,
    series,
    production: created.production,
    sku: parsed.sku,
    amount: created.estimate.retail,
    origin: req.headers.get("origin") ?? "http://127.0.0.1:43123",
  });
  if (!checkout.ok) return json({ error: checkout.error }, checkout.status);

  await supabase
    .from("productions")
    .update({ stripe_checkout_id: checkout.id, updated_at: new Date().toISOString() })
    .eq("id", created.production.id);

  return json({
    ...publicProduction(created.production, {
      series_title: series.title,
      poster_tone: seriesPoster(series),
    }),
    checkout: { id: checkout.id, url: checkout.url },
  }, 201);
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
  const amount = retailForBlock(
    Number(production.sku) as BlockSku,
    production.priority as ProductionPriority,
    production.episode_length as EpisodeLength,
  );
  await supabase.from("project_ledger").insert({
    owner_id: production.owner_id,
    series_id: production.series_id,
    entry_type: "purchase",
    amount,
    stripe_event_id: `test_${production.id}`,
    price_snapshot_version: PRICE_SNAPSHOT_VERSION,
  });
  const { data, error } = await supabase
    .from("productions")
    .update({
      status: "queued",
      ui_phase: "preparing",
      paid_amount: amount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
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

async function createCheckout(
  req: Request,
  supabase: ReturnType<typeof serviceClient>,
  userId: string,
  isAdmin: boolean,
) {
  const body = await req.json();
  if (!isCatalogSku(body.sku)) return json({ error: "sku must be 2|12|24|45|60|topup" }, 400);
  const series = await ownedSeries(supabase, userId, body.series_id, isAdmin);
  if (!series) return json({ error: "Series not found" }, 404);
  const amount = body.sku === "topup"
    ? SEASON_PRICES_USD.topup
    : retailForBlock(
        body.sku,
        isPriority(body.priority) ? body.priority : "balanced",
        isEpisodeLength(body.episode_length) ? body.episode_length : "60_90",
      );
  const checkout = await stripeCheckout({
    supabase,
    userId,
    email: body.email,
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
  email?: string;
  series: { id: string; owner_id: string };
  production: { id: string } | null;
  sku: string | number;
  amount: number;
  origin: string;
}): Promise<{ ok: true; id: string; url: string } | { ok: false; error: string; status: number }> {
  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!secret) return { ok: false, error: "Stripe is not configured", status: 500 };
  if (!secret.startsWith("sk_test_") && !secret.startsWith("rk_test_")) {
    return { ok: false, error: "Live Stripe is blocked until the legal entity is complete", status: 503 };
  }
  const customerId = await ensureStripeCustomer(input.supabase, secret, input.userId, input.email);
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set(
    "success_url",
    input.production
      ? `${input.origin}/productions/${input.production.id}?checkout=success`
      : `${input.origin}/productions?checkout=success`,
  );
      params.set("cancel_url", `${input.origin}/new?checkout=cancel`);
  params.set("client_reference_id", input.production?.id ?? input.series.id);
  params.set("metadata[owner_id]", input.series.owner_id);
  params.set("metadata[series_id]", input.series.id);
  params.set("metadata[sku]", String(input.sku));
  if (input.production) params.set("metadata[production_id]", input.production.id);
  params.set("payment_intent_data[metadata][owner_id]", input.series.owner_id);
  params.set("payment_intent_data[metadata][series_id]", input.series.id);
  params.set("payment_intent_data[metadata][sku]", String(input.sku));
  if (input.production) params.set("payment_intent_data[metadata][production_id]", input.production.id);
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "usd");
  params.set("line_items[0][price_data][unit_amount]", String(Math.round(input.amount * 100)));
  params.set(
    "line_items[0][price_data][product_data][name]",
    input.sku === "topup" ? "Season top-up" : input.sku === 2 || input.sku === "2" ? "2-episode pilot" : `${input.sku}-episode run`,
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
  email?: string,
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
