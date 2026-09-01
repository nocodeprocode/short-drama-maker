import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MUSIC_LIBRARY, type MusicLibraryEntry } from "../../types/audio.ts";

/** Library files are `assets/music/**` relative to MUSIC_ROOT (default: cwd). */
export function musicRoot(cwd = process.cwd()): string {
  return process.env.MUSIC_ROOT?.trim() || cwd;
}

export function resolveMusicFile(entry: MusicLibraryEntry, cwd = musicRoot()): string | null {
  const absolute = resolve(cwd, entry.file);
  return existsSync(absolute) ? absolute : null;
}

export function loadMusicBytes(entry: MusicLibraryEntry, cwd = musicRoot()): Uint8Array | null {
  const file = resolveMusicFile(entry, cwd);
  if (!file) return null;
  return new Uint8Array(readFileSync(file));
}

export function pickMusic(kind: MusicLibraryEntry["kind"], mood?: string | null): MusicLibraryEntry | null {
  const rows = MUSIC_LIBRARY.filter((entry) => entry.kind === kind);
  if (!rows.length) return null;
  if (mood) {
    const exact = rows.find((entry) => entry.mood === mood || entry.id.includes(mood));
    if (exact) return exact;
  }
  return rows[0] ?? null;
}

export function libraryReady(cwd = musicRoot()): boolean {
  return MUSIC_LIBRARY.filter((entry) => entry.kind === "bed").some((entry) => resolveMusicFile(entry, cwd));
}

export { MUSIC_LIBRARY };
