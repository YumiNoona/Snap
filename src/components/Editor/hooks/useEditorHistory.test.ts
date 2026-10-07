import { createElement, useState } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { DEFAULT_EDITOR_CONFIG, type AudioTrack, type CaptionTrack, type Keyframe } from "../../../lib/types";
import { useEditorHistory } from "./useEditorHistory";

it("undoes and redoes audio import, volume changes and removal", async () => {
  vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  let history!: ReturnType<typeof useEditorHistory>;
  let tracks: AudioTrack[] = [];
  let change!: (tracks: AudioTrack[]) => void;
  function Harness() {
    const [config, setConfig] = useState(DEFAULT_EDITOR_CONFIG);
    const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
    const [captions, setCaptions] = useState<CaptionTrack[]>([]);
    const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
    tracks = audioTracks; change = setAudioTracks;
    history = useEditorHistory({ config, setConfig, keyframes, setKeyframes, captions, setCaptions, audioTracks, setAudioTracks });
    return null;
  }
  const track: AudioTrack = { id: "voice", kind: "imported", label: "Voice", path: "voice.wav", muted: false, volume: 1 };
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(createElement(Harness)); });
    await act(async () => { change([track]); });
    await act(async () => { change([{ ...track, volume: .4 }]); });
    await act(async () => { change([]); });
    await act(async () => { history.undo(); });
    expect(tracks[0].volume).toBe(.4);
    await act(async () => { history.undo(); });
    expect(tracks[0].volume).toBe(1);
    await act(async () => { history.undo(); });
    expect(tracks).toEqual([]);
    await act(async () => { history.redo(); });
    expect(tracks).toEqual([track]);
  } finally {
    if (renderer) await act(async () => { renderer.unmount(); });
    consoleError.mockRestore(); vi.unstubAllGlobals();
  }
});
