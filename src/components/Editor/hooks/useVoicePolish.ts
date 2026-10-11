import { useEffect, useMemo, useState } from "react";
import type { AudioTrack } from "../../../lib/types";
import { prepareVoiceTracks } from "../../../lib/voicePolish";
import { userError } from "../../../lib/userError";

export function useVoicePolish(tracks: AudioTrack[], bypass: boolean) {
  const sources = useMemo(
    () =>
      tracks.map((t) => ({
        id: t.id,
        path: t.path,
        voicePolish: t.voicePolish,
      })),
    [tracks],
  );
  const signature = JSON.stringify(sources);
  const [prepared, setPrepared] = useState<{
    signature: string;
    paths: Record<string, string>;
  }>({ signature: "", paths: {} });
  const [status, setStatus] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (!sources.some((t) => t.voicePolish?.enabled)) {
      setStatus("");
      return;
    }
    setStatus("Preparing local voice polish…");
    const timer = window.setTimeout(() => {
      void prepareVoiceTracks(sources as AudioTrack[])
        .then((result) => {
          if (cancelled) return;
          setPrepared({
            signature,
            paths: Object.fromEntries(result.map((t) => [t.id, t.path])),
          });
          setStatus("Voice polish ready — preview and export match.");
        })
        .catch((e) => {
          if (!cancelled)
            setStatus(`Voice polish unavailable: ${userError(e)}`);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // Source settings, not volume/timeline edits, trigger rendering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  const audio = useMemo(
    () =>
      bypass || prepared.signature !== signature
        ? tracks
        : tracks.map((t) =>
            t.voicePolish?.enabled
              ? {
                  ...t,
                  path: prepared.paths[t.id] ?? t.path,
                  noiseReduction: false,
                }
              : t,
          ),
    [tracks, bypass, prepared, signature],
  );
  return { audio, status };
}
