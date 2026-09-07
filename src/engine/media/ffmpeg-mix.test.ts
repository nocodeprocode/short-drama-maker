import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ffmpegAvailable } from "../../drama-engine/editorial/cut-detect.ts";
import { heardDelaySeconds } from "../pipeline/heard-audio.ts";
import {
  assembleEpisodeMp4,
  captionForceStyle,
  captionOverlayFilter,
  clipFadeFilters,
  encodePortraitSlate,
  heardBodyForShot,
  shouldKeepTakeAudio,
  silentWav,
  stingTimesMs,
} from "./ffmpeg-mix.ts";
import type { RenderManifest } from "../domain.ts";

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${code}`))));
  });
}

function goertzel(samples: Int16Array, rate: number, hz: number): number {
  const w = (2 * Math.PI * hz) / rate;
  const coeff = 2 * Math.cos(w);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (const sample of samples) {
    s0 = sample + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

const manifest: RenderManifest = {
  version: 1,
  episode_id: "ep-mix",
  shots: [
    {
      shot_id: "s1",
      asset_id: "a1",
      in_point_seconds: 0,
      out_point_seconds: 2,
      picture_start_seconds: 0,
      audio_start_seconds: 0,
      hold_tail_seconds: 0.4,
      scene_kind: "dialogue",
      transition_in: "cut",
    },
    {
      shot_id: "s2",
      asset_id: "a2",
      in_point_seconds: 0,
      out_point_seconds: 2,
      picture_start_seconds: 2,
      audio_start_seconds: 2,
      scene_kind: "button",
      transition_in: "lcut",
      spike: true,
    },
  ],
  caption_asset_ids: [],
  music_asset_ids: [],
  sfx_asset_ids: [],
  transitions: [{ after_shot_id: "s1", type: "lcut", overlap_seconds: 0.4 }],
  scenes: [
    { index: 0, kind: "dialogue", shot_ids: ["s1"] },
    { index: 1, kind: "button", shot_ids: ["s2"] },
  ],
};

describe("ffmpeg mix", () => {
  it("does not fire the impact sting on the first frame", () => {
    expect(stingTimesMs(manifest, 8)).toEqual([2000]);
    expect(
      stingTimesMs(
        {
          ...manifest,
          shots: [
            { ...manifest.shots[0]!, sting: true, picture_start_seconds: 0, scene_kind: "button" },
            { ...manifest.shots[1]!, sting: true, picture_start_seconds: 14, scene_kind: "button" },
          ],
        },
        16,
      ),
    ).toEqual([14000]);
  });

  it("fades scene-take joins instead of a hard cut", () => {
    expect(clipFadeFilters({ duration: 14, fadeIn: true, fadeOut: true }).join(",")).toMatch(/fade=t=in:st=0/);
    expect(clipFadeFilters({ duration: 14, fadeIn: true, fadeOut: true }).join(",")).toMatch(/fade=t=out/);
    expect(clipFadeFilters({ duration: 14 })).toEqual([]);
  });

  it("does not drop take audio on audio-conditioned native shots", () => {
    const take = new Uint8Array([1, 2, 3, 4]);
    const tts = new Uint8Array([9, 9, 9, 9]);
    expect(shouldKeepTakeAudio("native")).toBe(true);
    expect(shouldKeepTakeAudio("tts")).toBe(false);
    expect(heardBodyForShot("native", take, tts)).toBe(take);
    expect(heardBodyForShot("native", take, tts)).not.toBe(tts);
    expect(heardBodyForShot("native", null, tts)).toBeNull();
  });

  it("does not J-cut onscreen speech before the picture", () => {
    expect(
      heardDelaySeconds({
        pictureStartSeconds: 4,
        audioStartSeconds: 3.2,
        audioRole: "onscreen",
      }),
    ).toBe(4);
  });

  it("never ships a sine/ping bed", () => {
    const wav = silentWav(1);
    const samples = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.byteLength - 44) / 2);
    expect(samples.every((sample) => sample === 0)).toBe(true);
    expect(String(assembleEpisodeMp4)).not.toMatch(/Math\.sin|110Hz|880Hz|deterministicBed/);
  });

  it("burns captions in the lower-third safe band, not chest-center or TikTok chrome", () => {
    const style = captionForceStyle(1280);
    const marginV = Number(/MarginV=(\d+)/.exec(style)?.[1]);
    const fromTopPct = (1 - marginV / 1280) * 100;
    expect(fromTopPct).toBeGreaterThanOrEqual(70);
    expect(fromTopPct).toBeLessThanOrEqual(82);
    expect(marginV).toBeLessThan(400);
    const overlay = captionOverlayFilter([{ start: 1.35, end: 3.2 }]);
    expect(overlay).toContain("overlay=0:0");
    expect(overlay).toContain("between(t,1.350,3.200)");
  });

  it("outputs a watchable MP4 with J/L-cut timeline metadata", async () => {
    if (!(await ffmpegAvailable())) return;
    const slate = await encodePortraitSlate(2);
    expect(slate).toBeTruthy();
    expect(slate!.byteLength).toBeGreaterThan(2_000);
    const mixed = await assembleEpisodeMp4({
      manifest,
      shotBodies: [slate!, slate!],
      vtt: "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.200\nYou knew.\n",
    });
    expect(mixed).toBeTruthy();
    expect(mixed!.byteLength).toBeGreaterThan(32);
    expect(String.fromCharCode(mixed![4]!, mixed![5]!, mixed![6]!, mixed![7]!)).toBe("ftyp");
  });

  it("keeps audio-conditioned take audio and does not mux TTS over it", async () => {
    if (!(await ffmpegAvailable())) return;
    const dir = await mkdtemp(join(tmpdir(), "sdm-native-mix-"));
    try {
      const silent = await encodePortraitSlate(2);
      expect(silent).toBeTruthy();
      const takePath = join(dir, "take.mp4");
      await run("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x333333:s=720x1280:d=2:r=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1000:sample_rate=44100:duration=2",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-c:a",
        "aac",
        "-shortest",
        takePath,
      ]);
      const take = new Uint8Array(await readFile(takePath));
      const ttsPath = join(dir, "tts.wav");
      await run("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=400:sample_rate=44100:duration=2",
        ttsPath,
      ]);
      const tts = new Uint8Array(await readFile(ttsPath));
      const nativeManifest: RenderManifest = {
        version: 1,
        episode_id: "ep-native-keep",
        shots: [
          {
            shot_id: "plant",
            asset_id: "plant",
            in_point_seconds: 0,
            out_point_seconds: 2,
            picture_start_seconds: 0,
            audio_start_seconds: 0,
            hold_tail_seconds: 0,
            scene_kind: "dialogue",
            transition_in: "cut",
            audio_role: "silent",
            heard_audio: "silent",
          },
          {
            shot_id: "cu",
            asset_id: "cu",
            in_point_seconds: 0,
            out_point_seconds: 2,
            picture_start_seconds: 2,
            audio_start_seconds: 2,
            hold_tail_seconds: 0,
            scene_kind: "dialogue",
            transition_in: "cut",
            audio_role: "onscreen",
            heard_audio: "native",
          },
        ],
        caption_asset_ids: [],
        music_asset_ids: [],
        sfx_asset_ids: [],
        transitions: [],
        scenes: [{ index: 0, kind: "dialogue", shot_ids: ["plant", "cu"] }],
      };
      expect(heardBodyForShot("native", take, tts)).toBe(take);
      const mixed = await assembleEpisodeMp4({
        manifest: nativeManifest,
        shotBodies: [silent!, take],
        ttsBodies: [null, tts],
        nativeAudio: [null, tts],
        heardLanes: ["silent", "native"],
        visemeWanDialogue: [false, false],
        visemeMouthOpenSeconds: [null, 0],
      });
      expect(mixed).toBeTruthy();
      const out = join(dir, "mixed.mp4");
      const wav = join(dir, "mixed.wav");
      await writeFile(out, mixed!);
      await run("ffmpeg", ["-y", "-i", out, "-ac", "1", "-ar", "44100", wav]);
      const pcm = await readFile(wav);
      const samples = new Int16Array(pcm.buffer, pcm.byteOffset + 44, Math.floor((pcm.byteLength - 44) / 2));
      const early = samples.subarray(0, 44100);
      const late = samples.subarray(Math.round(2.15 * 44100), Math.round(3.6 * 44100));
      expect(goertzel(late, 44100, 1000)).toBeGreaterThan(goertzel(late, 44100, 400) * 4);
      expect(goertzel(late, 44100, 1000)).toBeGreaterThan(goertzel(early, 44100, 1000) * 3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("aligns native audio that leads the mouth by 1.2s so output onsets sit within 80ms", async () => {
    if (!(await ffmpegAvailable())) return;
    const dir = await mkdtemp(join(tmpdir(), "sdm-viseme-mix-"));
    try {
      const takePath = join(dir, "lead.mp4");
      await run("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x222222:s=720x1280:d=4:r=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1000:sample_rate=44100:duration=4",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-c:a",
        "aac",
        "-shortest",
        takePath,
      ]);
      const take = new Uint8Array(await readFile(takePath));
      const leadManifest: RenderManifest = {
        version: 1,
        episode_id: "ep-viseme",
        shots: [
          {
            shot_id: "cu",
            asset_id: "cu",
            in_point_seconds: 0,
            out_point_seconds: 4,
            picture_start_seconds: 0,
            audio_start_seconds: 0,
            hold_tail_seconds: 0,
            scene_kind: "dialogue",
            transition_in: "cut",
            audio_role: "onscreen",
            heard_audio: "native",
          },
        ],
        caption_asset_ids: [],
        music_asset_ids: [],
        sfx_asset_ids: [],
        transitions: [],
        scenes: [{ index: 0, kind: "dialogue", shot_ids: ["cu"] }],
      };
      const mixed = await assembleEpisodeMp4({
        manifest: leadManifest,
        shotBodies: [take],
        heardLanes: ["native"],
        visemeMouthOpenSeconds: [1.2],
        visemeWanDialogue: [true],
      });
      expect(mixed).toBeTruthy();
      const out = join(dir, "mixed.mp4");
      const wav = join(dir, "mixed.wav");
      await writeFile(out, mixed!);
      await run("ffmpeg", ["-y", "-i", out, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", wav]);
      const pcm = await readFile(wav);
      let dataAt = 12;
      while (dataAt + 8 <= pcm.byteLength) {
        const id = pcm.toString("ascii", dataAt, dataAt + 4);
        const size = pcm.readUInt32LE(dataAt + 4);
        if (id === "data") {
          dataAt += 8;
          break;
        }
        dataAt += 8 + size + (size % 2);
      }
      const samples = new Int16Array(pcm.buffer, pcm.byteOffset + dataAt, Math.floor((pcm.byteLength - dataAt) / 2));
      const hop = Math.round(44100 * 0.01);
      const win = Math.round(44100 * 0.04);
      const energies: number[] = [];
      for (let i = 0; i + win < samples.length; i += hop) {
        energies.push(goertzel(samples.subarray(i, i + win), 44100, 1000));
      }
      const peak = Math.max(0, ...energies);
      const voiceIdx = energies.findIndex((g) => g > peak * 0.25 && g > 1e11);
      const voiceOut = voiceIdx >= 0 ? Number(((voiceIdx * hop) / 44100).toFixed(3)) : null;
      expect(voiceOut).not.toBeNull();
      const mouthOut = 1.2 - 1.05;
      expect(Math.abs((voiceOut ?? 0) - mouthOut)).toBeLessThanOrEqual(0.08);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("muxes an already-aligned native take with pad 0", async () => {
    if (!(await ffmpegAvailable())) return;
    const dir = await mkdtemp(join(tmpdir(), "sdm-aligned-mix-"));
    try {
      const takePath = join(dir, "sync.mp4");
      await run("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x222222:s=720x1280:d=4:r=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1000:sample_rate=44100:duration=4",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-c:a",
        "aac",
        "-shortest",
        takePath,
      ]);
      const take = new Uint8Array(await readFile(takePath));
      const mixed = await assembleEpisodeMp4({
        manifest: {
          version: 1,
          episode_id: "ep-aligned",
          shots: [
            {
              shot_id: "cu",
              asset_id: "cu",
              in_point_seconds: 0,
              out_point_seconds: 4,
              picture_start_seconds: 0,
              audio_start_seconds: 0,
              hold_tail_seconds: 0,
              scene_kind: "dialogue",
              transition_in: "cut",
              audio_role: "onscreen",
              heard_audio: "native",
            },
          ],
          caption_asset_ids: [],
          music_asset_ids: [],
          sfx_asset_ids: [],
          transitions: [],
          scenes: [{ index: 0, kind: "dialogue", shot_ids: ["cu"] }],
        },
        shotBodies: [take],
        heardLanes: ["native"],
        visemeMouthOpenSeconds: [0.05],
        visemeWanDialogue: [true],
      });
      expect(mixed).toBeTruthy();
      const out = join(dir, "mixed.mp4");
      const wav = join(dir, "mixed.wav");
      await writeFile(out, mixed!);
      await run("ffmpeg", ["-y", "-i", out, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", wav]);
      const pcm = await readFile(wav);
      let dataAt = 12;
      while (dataAt + 8 <= pcm.byteLength) {
        const id = pcm.toString("ascii", dataAt, dataAt + 4);
        const size = pcm.readUInt32LE(dataAt + 4);
        if (id === "data") {
          dataAt += 8;
          break;
        }
        dataAt += 8 + size + (size % 2);
      }
      const samples = new Int16Array(pcm.buffer, pcm.byteOffset + dataAt, Math.floor((pcm.byteLength - dataAt) / 2));
      const early = samples.subarray(0, Math.round(0.45 * 44100));
      const late = samples.subarray(Math.round(1.2 * 44100), Math.round(1.8 * 44100));
      expect(goertzel(early, 44100, 1000)).toBeGreaterThan(1e12);
      expect(goertzel(early, 44100, 1000)).toBeGreaterThan(goertzel(late, 44100, 1000) * 0.15);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("honors a 1.0s per-take pad so an Eli-like lead lands within 150ms", async () => {
    if (!(await ffmpegAvailable())) return;
    const dir = await mkdtemp(join(tmpdir(), "sdm-eli-pad-"));
    try {
      const takePath = join(dir, "lead.mp4");
      await run("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x222222:s=720x1280:d=4:r=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1000:sample_rate=44100:duration=4",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-c:a",
        "aac",
        "-shortest",
        takePath,
      ]);
      const take = new Uint8Array(await readFile(takePath));
      const mixed = await assembleEpisodeMp4({
        manifest: {
          version: 1,
          episode_id: "ep-eli-pad",
          shots: [
            {
              shot_id: "cu",
              asset_id: "cu",
              in_point_seconds: 0,
              out_point_seconds: 4,
              picture_start_seconds: 0,
              audio_start_seconds: 0,
              hold_tail_seconds: 0,
              scene_kind: "dialogue",
              transition_in: "cut",
              audio_role: "onscreen",
              heard_audio: "native",
            },
          ],
          caption_asset_ids: [],
          music_asset_ids: [],
          sfx_asset_ids: [],
          transitions: [],
          scenes: [{ index: 0, kind: "dialogue", shot_ids: ["cu"] }],
        },
        shotBodies: [take],
        heardLanes: ["native"],
        visemeMouthOpenSeconds: [1.0],
        visemeVoiceOnsetSeconds: [0],
        visemeWanDialogue: [true],
      });
      expect(mixed).toBeTruthy();
      const out = join(dir, "mixed.mp4");
      const wav = join(dir, "mixed.wav");
      await writeFile(out, mixed!);
      await run("ffmpeg", ["-y", "-i", out, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", wav]);
      const pcm = await readFile(wav);
      let dataAt = 12;
      while (dataAt + 8 <= pcm.byteLength) {
        const id = pcm.toString("ascii", dataAt, dataAt + 4);
        const size = pcm.readUInt32LE(dataAt + 4);
        if (id === "data") {
          dataAt += 8;
          break;
        }
        dataAt += 8 + size + (size % 2);
      }
      const samples = new Int16Array(pcm.buffer, pcm.byteOffset + dataAt, Math.floor((pcm.byteLength - dataAt) / 2));
      const hop = Math.round(44100 * 0.01);
      const win = Math.round(44100 * 0.04);
      const energies: number[] = [];
      for (let i = 0; i + win < samples.length; i += hop) {
        energies.push(goertzel(samples.subarray(i, i + win), 44100, 1000));
      }
      const peak = Math.max(0, ...energies);
      const voiceIdx = energies.findIndex((g) => g > peak * 0.25 && g > 1e11);
      const voiceOut = voiceIdx >= 0 ? Number(((voiceIdx * hop) / 44100).toFixed(3)) : null;
      expect(voiceOut).not.toBeNull();
      const mouthOut = 1.0 - 0.85;
      expect(Math.abs((voiceOut ?? 0) - mouthOut)).toBeLessThanOrEqual(0.15);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("trims native heard audio by the same in-point as the I2V settle cut", async () => {
    if (!(await ffmpegAvailable())) return;
    const dir = await mkdtemp(join(tmpdir(), "sdm-settle-"));
    try {
      const takePath = join(dir, "settle.mp4");
      await run("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x222222:s=720x1280:d=3:r=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1000:sample_rate=44100:duration=3",
        "-filter_complex",
        "[1:a]adelay=1000|1000[a]",
        "-map",
        "0:v",
        "-map",
        "[a]",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-c:a",
        "aac",
        "-shortest",
        takePath,
      ]);
      const take = new Uint8Array(await readFile(takePath));
      const mixed = await assembleEpisodeMp4({
        manifest: {
          version: 1,
          episode_id: "ep-settle",
          shots: [
            {
              shot_id: "cu",
              asset_id: "cu",
              in_point_seconds: 0.5,
              out_point_seconds: 3,
              picture_start_seconds: 0,
              audio_start_seconds: 0,
              hold_tail_seconds: 0,
              scene_kind: "dialogue",
              transition_in: "cut",
              audio_role: "onscreen",
              heard_audio: "native",
            },
          ],
          caption_asset_ids: [],
          music_asset_ids: [],
          sfx_asset_ids: [],
          transitions: [],
          scenes: [{ index: 0, kind: "dialogue", shot_ids: ["cu"] }],
        },
        shotBodies: [take],
        heardLanes: ["native"],
        visemePadSeconds: [0],
        visemeWanDialogue: [true],
      });
      expect(mixed).toBeTruthy();
      const out = join(dir, "mixed.mp4");
      const wav = join(dir, "mixed.wav");
      await writeFile(out, mixed!);
      await run("ffmpeg", ["-y", "-i", out, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", wav]);
      const pcm = await readFile(wav);
      let dataAt = 12;
      while (dataAt + 8 <= pcm.byteLength) {
        const id = pcm.toString("ascii", dataAt, dataAt + 4);
        const size = pcm.readUInt32LE(dataAt + 4);
        if (id === "data") {
          dataAt += 8;
          break;
        }
        dataAt += 8 + size + (size % 2);
      }
      const samples = new Int16Array(pcm.buffer, pcm.byteOffset + dataAt, Math.floor((pcm.byteLength - dataAt) / 2));
      const hop = Math.round(44100 * 0.01);
      const win = Math.round(44100 * 0.04);
      const energies: number[] = [];
      for (let i = 0; i + win < samples.length; i += hop) {
        energies.push(goertzel(samples.subarray(i, i + win), 44100, 1000));
      }
      const peak = Math.max(0, ...energies);
      const voiceIdx = energies.findIndex((g) => g > peak * 0.25 && g > 1e11);
      const voiceOut = voiceIdx >= 0 ? Number(((voiceIdx * hop) / 44100).toFixed(3)) : null;
      expect(voiceOut).not.toBeNull();
      expect(voiceOut ?? 0).toBeGreaterThanOrEqual(0.4);
      expect(voiceOut ?? 0).toBeLessThanOrEqual(0.65);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps locked Seedance speech on the picture clock with no pad", async () => {
    if (!(await ffmpegAvailable())) return;
    const dir = await mkdtemp(join(tmpdir(), "sdm-locked-mix-"));
    try {
      const takePath = join(dir, "take.mp4");
      await run("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=0x222222:s=720x1280:d=2:r=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1000:sample_rate=44100:duration=2",
        "-map",
        "0:v",
        "-map",
        "1:a",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-c:a",
        "aac",
        "-shortest",
        takePath,
      ]);
      const take = new Uint8Array(await readFile(takePath));
      const mixed = await assembleEpisodeMp4({
        manifest: {
          version: 1,
          episode_id: "ep-locked",
          shots: [
            {
              shot_id: "st",
              asset_id: "st",
              in_point_seconds: 0,
              out_point_seconds: 2,
              picture_start_seconds: 0,
              audio_start_seconds: 0,
              hold_tail_seconds: 0,
              scene_kind: "dialogue",
              transition_in: "cut",
              audio_role: "onscreen",
              heard_audio: "native",
            },
          ],
          caption_asset_ids: [],
          music_asset_ids: [],
          sfx_asset_ids: [],
          transitions: [],
          scenes: [{ index: 0, kind: "dialogue", shot_ids: ["st"] }],
        },
        shotBodies: [take],
        heardLanes: ["native"],
        visemePadSeconds: [1.2],
        lockedNative: [true],
      });
      expect(mixed).toBeTruthy();
      const out = join(dir, "mixed.mp4");
      const wav = join(dir, "mixed.wav");
      await writeFile(out, mixed!);
      await run("ffmpeg", ["-y", "-i", out, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", wav]);
      const pcm = await readFile(wav);
      let dataAt = 12;
      while (dataAt + 8 <= pcm.byteLength) {
        const id = pcm.toString("ascii", dataAt, dataAt + 4);
        const size = pcm.readUInt32LE(dataAt + 4);
        if (id === "data") {
          dataAt += 8;
          break;
        }
        dataAt += 8 + size + (size % 2);
      }
      const samples = new Int16Array(pcm.buffer, pcm.byteOffset + dataAt, Math.floor((pcm.byteLength - dataAt) / 2));
      const early = samples.subarray(0, Math.round(0.35 * 44100));
      const delayed = samples.subarray(Math.round(1.1 * 44100), Math.round(1.4 * 44100));
      expect(goertzel(early, 44100, 1000)).toBeGreaterThan(1e12);
      expect(goertzel(early, 44100, 1000)).toBeGreaterThan(goertzel(delayed, 44100, 1000) * 0.15);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
