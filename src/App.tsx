import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import RecorderLauncher from "./components/RecorderLauncher/RecorderLauncher";
import RecordingDock from "./components/RecorderLauncher/RecordingDock";
import RecordingOverlay from "./components/RecorderLauncher/RecordingOverlay";
import Editor from "./components/Editor/Editor";
import TeleprompterWindow from "./components/Teleprompter/TeleprompterWindow";
import "./App.css";

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
  const appWindow = getCurrentWindow();
  const isEditorWindow = appWindow.label === "editor";
  const isDockWindow = appWindow.label === "dock";
  const isOverlayWindow = appWindow.label === "recorder-overlay";
  const isTeleprompterWindow = appWindow.label === "teleprompter";

  const [editorVideo, setEditorVideo] = useState("");
  const [editorLog, setEditorLog] = useState("");
  const [editorReady, setEditorReady] = useState(!isEditorWindow);
  const [editorError, setEditorError] = useState<string | null>(null);

  // Load the pending recording handed over by the launcher window.
  useEffect(() => {
    if (!isEditorWindow) return;
    (async () => {
      try {
        const [video, log] = await invoke<[string, string]>("get_pending_editor_paths");
        setEditorVideo(video);
        setEditorLog(log);
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
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [isEditorWindow]);

  const openInEditorWindow = useCallback(
    (video: string, log: string) => {
      setEditorError(null);
      invoke("open_editor_window", { video, log }).catch((e) => {
        console.error("open_editor_window failed:", e);
        setEditorError(String(e));
      });
    },
    []
  );

  const closeEditorWindow = useCallback(() => {
    appWindow.close();
  }, [appWindow]);

  const openTeleprompterWindow = useCallback(() => {
    invoke("open_teleprompter_window").catch((e) => {
      console.error("open_teleprompter_window failed:", e);
    });
  }, []);

  const closeTeleprompterWindow = useCallback(() => {
    appWindow.close();
  }, [appWindow]);

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

  useEffect(() => {
    if (isEditorWindow || isTeleprompterWindow) {
      invoke("window_ready").catch(() => {});
    }
  }, [isEditorWindow, isTeleprompterWindow]);

  if (isEditorWindow) {
    if (editorVideo) {
      return (
        <ErrorBoundary onReset={closeEditorWindow}>
          <Editor videoPath={editorVideo} inputLogPath={editorLog || editorVideo.replace(/\.[^/.]+$/, ".json")} onClose={closeEditorWindow} />
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
                const jsonPath = latest.path.replace(/\.mp4$/, ".json");
                setEditorVideo(latest.path);
                setEditorLog(jsonPath);
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
      <RecorderLauncher onOpenEditor={openInEditorWindow} onOpenTeleprompter={openTeleprompterWindow} editorError={editorError} />
    </ErrorBoundary>
  );
}

export default App;
