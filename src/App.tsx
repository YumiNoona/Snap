import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import RecorderLauncher from "./components/RecorderLauncher/RecorderLauncher";
import DeviceView from "./components/RecorderLauncher/DeviceView";
import RecordingDock from "./components/RecorderLauncher/RecordingDock";
import RecordingOverlay from "./components/RecorderLauncher/RecordingOverlay";
import Editor from "./components/Editor/Editor";
import TeleprompterWindow from "./components/Teleprompter/TeleprompterWindow";
import SettingsWindow from "./components/Settings/SettingsWindow";
import LibraryWindow from "./components/LibraryWindow";
import DonateWindow from "./components/DonateWindow";
import WindowPickerWindow from "./components/RecorderLauncher/WindowPickerWindow";
import "./App.css";
import { recordingDataPaths } from "./lib/recordingPaths";

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; onReset: () => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Editor Component Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-screen">
          <h2>Something went wrong in the Editor</h2>
          <p className="error-boundary-message">
            {this.state.error?.message}
          </p>
          <button
            className="error-boundary-btn"
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onReset();
            }}
          >
            Back to Recorder
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// The editor lives in its own dedicated window ("editor" label); the launcher
// runs in the main window. App routes to the right shell per window label.
function App() {
  // Window identity comes from the URL (?window=editor, set by the Rust side
  // in src-tauri/src/lib.rs and tauri.conf.json), NOT from getCurrentWindow().
  //
  // getCurrentWindow() reads window.__TAURI_INTERNALS__.metadata, which Tauri
  // injects asynchronously and is NOT guaranteed ready the instant this
  // component first renders — especially on Windows (open upstream bugs:
  // tauri-apps/tauri #12694, #12990). Calling it unguarded here, at the very
  // top of App's render, means that if it throws, the crash happens *above*
  // every ErrorBoundary in the tree below — React unmounts everything and the
  // window just goes permanently blank, with nothing left to catch or show
  // an error for. Reading the label from the URL is synchronous, available
  // immediately on first paint, and has zero dependency on Tauri's IPC state.
  const windowParams = new URLSearchParams(window.location.search);
  const windowLabel = windowParams.get("window") ?? "main";
  const isEditorPreview = import.meta.env.DEV && windowParams.get("preview") === "1";
  const editorPreviewVideo = windowParams.get("previewVideo") || "/__snap-editor-preview__.mp4";
  const isEditorWindow = windowLabel === "editor";
  const isDockWindow = windowLabel === "dock";
  const isOverlayWindow = windowLabel === "recorder-overlay";
  const isTeleprompterWindow = windowLabel === "teleprompter";
  const isSettingsWindow = windowLabel === "settings";
  const isDeviceWindow = windowLabel === "device";
  const isLibraryWindow = windowLabel === "library";
  const isDonateWindow = windowLabel === "donate";
  const isWindowPickerWindow = windowLabel === "window-picker";

  const [editorVideo, setEditorVideo] = useState(isEditorPreview ? editorPreviewVideo : "");
  const [editorLog, setEditorLog] = useState("");
  const [editorProjectPath, setEditorProjectPath] = useState("");
  const [editorReady, setEditorReady] = useState(!isEditorWindow);
  const [editorError, setEditorError] = useState<string | null>(null);

  // Load the pending recording handed over by the launcher window.
  useEffect(() => {
    if (!isEditorWindow || isEditorPreview) return;
    (async () => {
      try {
        const [video, log] = await invoke<[string, string]>("get_pending_editor_paths");
        setEditorVideo(video);
        setEditorLog(log);
        setEditorProjectPath("");
      } catch {
        // nothing pending yet — wait for the editor-open event
      } finally {
        setEditorReady(true);
      }
    })();
    const unlisten = listen<[string, string]>("editor-open", (e) => {
      const [video, log] = e.payload;
      setEditorVideo(video);
      setEditorLog(log);
      setEditorProjectPath("");
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [isEditorPreview, isEditorWindow]);

  const openInEditorWindow = useCallback(
    async (video: string, log: string) => {
      setEditorError(null);
      try {
        await invoke("open_editor_window", { video, log });
      } catch (e) {
        console.error("open_editor_window failed:", e);
        setEditorError(String(e));
        throw e;
      }
    },
    []
  );

  // getCurrentWindow() is safe to call here — these callbacks only ever run
  // in response to a user click, long after mount, well past the point where
  // Tauri's IPC bridge is guaranteed to be ready. It's only unsafe to call
  // synchronously during the component's first render (see note above).
  const closeEditorWindow = useCallback(() => {
    getCurrentWindow().close();
  }, []);

  const openTeleprompterWindow = useCallback(() => {
    invoke("open_teleprompter_window").catch((e) => {
      console.error("open_teleprompter_window failed:", e);
    });
  }, []);

  const closeTeleprompterWindow = useCallback(() => {
    getCurrentWindow().close();
  }, []);

  const openSettingsWindow = useCallback(() => {
    invoke("open_settings_window").catch((error) => {
      console.error("open_settings_window failed:", error);
    });
  }, []);

  useEffect(() => {
    if (!isEditorPreview && (windowLabel === "main" || isEditorWindow || isTeleprompterWindow || isSettingsWindow || isDeviceWindow || isLibraryWindow || isDonateWindow || isWindowPickerWindow)) {
      invoke("window_ready").catch(() => {});
    }
  }, [isEditorPreview, windowLabel, isEditorWindow, isTeleprompterWindow, isSettingsWindow, isDeviceWindow, isLibraryWindow, isDonateWindow, isWindowPickerWindow]);

  if (isDockWindow) {
    return (
      <ErrorBoundary onReset={closeEditorWindow}>
        <RecordingDock />
      </ErrorBoundary>
    );
  }

  if (isOverlayWindow) {
    return (
      <ErrorBoundary onReset={closeEditorWindow}>
        <RecordingOverlay />
      </ErrorBoundary>
    );
  }

  if (isTeleprompterWindow) {
    return (
      <ErrorBoundary onReset={closeTeleprompterWindow}>
        <TeleprompterWindow onClose={closeTeleprompterWindow} />
      </ErrorBoundary>
    );
  }

  if (isSettingsWindow) {
    return (
      <ErrorBoundary onReset={closeTeleprompterWindow}>
        <SettingsWindow />
      </ErrorBoundary>
    );
  }

  if (isDeviceWindow) {
    return <ErrorBoundary onReset={closeEditorWindow}><DeviceView onBack={closeEditorWindow} onOpenEditor={openInEditorWindow} /></ErrorBoundary>;
  }

  if (isLibraryWindow) {
    return <ErrorBoundary onReset={closeEditorWindow}><LibraryWindow onOpen={openInEditorWindow} /></ErrorBoundary>;
  }

  if (isDonateWindow) {
    return <ErrorBoundary onReset={closeEditorWindow}><DonateWindow /></ErrorBoundary>;
  }

  if (isWindowPickerWindow) {
    return <ErrorBoundary onReset={closeEditorWindow}><WindowPickerWindow /></ErrorBoundary>;
  }

  if (isEditorWindow) {
    if (editorVideo) {
      return (
        <ErrorBoundary onReset={closeEditorWindow}>
          <Editor
            key={`${editorVideo}|${editorProjectPath}`}
            videoPath={editorVideo}
            inputLogPath={editorLog || recordingDataPaths(editorVideo).logPath}
            initialProjectPath={editorProjectPath}
            onOpenProject={(projectPath, video, log) => {
              setEditorProjectPath(projectPath);
              setEditorVideo(video);
              setEditorLog(log);
            }}
            onClose={closeEditorWindow}
          />
        </ErrorBoundary>
      );
    }
    if (!editorReady) {
      return (
        <div className="app-layout" style={{ alignItems: "center", justifyContent: "center" }}>
          <span className="launcher-status-text">Opening editor…</span>
        </div>
      );
    }
    return (
      <div className="app-layout" style={{ alignItems: "center", justifyContent: "center", gap: "16px" }}>
        <span className="launcher-status-text" style={{ fontSize: "16px", color: "var(--text-secondary)" }}>
          No recording active. Record something or select a file to edit.
        </span>
        <button
          className="open-last-btn"
          onClick={async () => {
            try {
              const dir = await invoke<string>("get_videos_dir");
              const files = await invoke<Array<{ name: string; path: string; is_dir: boolean }>>("list_directory", { path: dir });
              const mp4s = files.filter((f) => !f.is_dir && f.name.endsWith(".mp4"));
              if (mp4s.length > 0) {
                const latest = mp4s[0];
                const jsonPath = await invoke<string>("resolve_recording_log_path", { videoPath: latest.path }).catch(() => recordingDataPaths(latest.path).logPath);
                setEditorVideo(latest.path);
                setEditorLog(jsonPath);
                setEditorProjectPath("");
              }
            } catch (e) {
              console.error("Failed to find recordings:", e);
            }
          }}
        >
          Load Latest Recording
        </button>
      </div>
    );
  }

  return (
    <ErrorBoundary onReset={() => {}}>
      <RecorderLauncher onOpenEditor={openInEditorWindow} onOpenTeleprompter={openTeleprompterWindow} onOpenSettings={openSettingsWindow} editorError={editorError} />
    </ErrorBoundary>
  );
}

export default App;
