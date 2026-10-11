import { invoke } from "@tauri-apps/api/core";
import type { AudioTrack } from "./types";

/** Only derived media paths are changed; persisted tracks always retain originals. */
export async function prepareVoiceTracks(
  tracks: AudioTrack[],
): Promise<AudioTrack[]> {
  return Promise.all(
    tracks.map(async (track) => {
      if (!track.voicePolish?.enabled) return track;
      const path = await invoke<string>("editor_cached_media", {
        path: track.path,
        kind: "voice",
        voice: track.voicePolish,
      });
      return { ...track, path, noiseReduction: false };
    }),
  );
}
