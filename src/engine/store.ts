import type {
  Actor,
  Asset,
  Character,
  Episode,
  GenerationJob,
  LedgerEntry,
  ModerationDecision,
  Scene,
  Series,
  Shot,
} from "./domain.ts";

export type QueueTask = {
  id: string;
  job_id: string;
  kind: "generate" | "ingest" | "render" | "gc" | "reconcile";
  created_at: string;
  visible_at: string;
};

export class MemoryStore {
  series = new Map<string, Series>();
  actors = new Map<string, Actor>();
  characters = new Map<string, Character>();
  episodes = new Map<string, Episode>();
  scenes = new Map<string, Scene>();
  shots = new Map<string, Shot>();
  jobs = new Map<string, GenerationJob>();
  ledger: LedgerEntry[] = [];
  moderation: ModerationDecision[] = [];
  queue: QueueTask[] = [];
  stripeEvents = new Set<string>();
  dailySpend = 0;
  /** Platform spend as loaded from the database; the commit writes only the delta. */
  dailySpendBaseline = 0;
  dailyCap = 2000;
  priceSnapshotVersion = "2026-08-31.v1-720p";
  /** Scene rows removed from memory during replan; commit deletes them from Postgres. */
  deletedSceneIds = new Set<string>();

  purgeEpisodePlan(episodeId: string): void {
    for (const scene of this.scenesFor(episodeId)) {
      for (const shot of this.shotsFor(scene.id)) {
        this.shots.delete(shot.id);
      }
      this.deletedSceneIds.add(scene.id);
      this.scenes.delete(scene.id);
    }
  }

  seriesByOwner(ownerId: string): Series[] {
    return [...this.series.values()].filter(
      (row) => row.owner_id === ownerId && !row.deleted_at,
    );
  }

  charactersFor(seriesId: string): Character[] {
    return [...this.characters.values()].filter((row) => row.series_id === seriesId);
  }

  actorsFor(ownerId: string): Actor[] {
    return [...this.actors.values()].filter((row) => row.owner_id === ownerId);
  }

  episodesFor(seriesId: string): Episode[] {
    return [...this.episodes.values()].filter((row) => row.series_id === seriesId);
  }

  scenesFor(episodeId: string): Scene[] {
    return [...this.scenes.values()]
      .filter((row) => row.episode_id === episodeId)
      .sort((a, b) => a.position - b.position);
  }

  shotsFor(sceneId: string): Shot[] {
    return [...this.shots.values()]
      .filter((row) => row.scene_id === sceneId)
      .sort((a, b) => a.position - b.position);
  }

  shotsForEpisode(episodeId: string): Shot[] {
    return this.scenesFor(episodeId).flatMap((scene) => this.shotsFor(scene.id));
  }

  jobByCallbackToken(token: string): GenerationJob | undefined {
    return [...this.jobs.values()].find((job) => job.callback_token === token);
  }

  jobByUpstream(provider: string, upstreamJobId: string): GenerationJob | undefined {
    return [...this.jobs.values()].find(
      (job) => job.provider === provider && job.upstream_job_id === upstreamJobId,
    );
  }

  selectedAssetIds(): Set<string> {
    const ids = new Set<string>();
    for (const shot of this.shots.values()) {
      if (shot.selected_generation_id) ids.add(shot.selected_generation_id);
      if (shot.shot_data.dialogue_audio_asset_id) {
        ids.add(shot.shot_data.dialogue_audio_asset_id);
      }
      if (shot.shot_data.dialogue_alignment_asset_id) {
        ids.add(shot.shot_data.dialogue_alignment_asset_id);
      }
    }
    for (const episode of this.episodes.values()) {
      for (const item of episode.render_manifest?.shots ?? []) {
        ids.add(item.asset_id);
      }
    }
    return ids;
  }
}

export type { Asset };
