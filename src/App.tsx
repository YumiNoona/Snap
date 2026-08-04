import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import RecorderLauncher from "./components/RecorderLauncher/RecorderLauncher";
import Editor from "./components/Editor/Editor";
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
        <div style={{ padding: 32, textAlign: "center", color: "#f87171", background: "#0d0d0d", height: "100vh" }}>
          <h2>Something went wrong in the Editor</h2>
          <p style={{ marginTop: 12, fontSize: 13, color: "#999" }}>
            {this.state.error?.message}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              this.props.onReset();
            }}
            style={{
              marginTop: 20,
              padding: "8px 20px",
              background: "#3b82f6",
              color: "#fff",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
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
  const [editorVideo, setEditorVideo] = useState("");
  const [editorLog, setEditorLog] = useState("");
  const [editorReady, setEditorReady] = useState(!isEditorWindow);

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
      invoke("open_editor_window", { video, log }).catch((e) => console.error(e));
    },
    []
  );

  const closeEditorWindow = useCallback(() => {
    appWindow.close();
  }, [appWindow]);

  if (isEditorWindow) {
    if (!editorReady) {
      return (
        <div className="app-layout" style={{ alignItems: "center", justifyContent: "center" }}>
          <span className="launcher-status-text">Opening editor…</span>
        </div>
      );
    }
    if (editorVideo && editorLog) {
      return (
        <ErrorBoundary onReset={closeEditorWindow}>
          <Editor videoPath={editorVideo} inputLogPath={editorLog} onClose={closeEditorWindow} />
        </ErrorBoundary>
      );
    }
    return (
      <div className="app-layout" style={{ alignItems: "center", justifyContent: "center" }}>
        <span className="launcher-status-text">No recording selected. Record something first.</span>
      </div>
    );
  }

  return <RecorderLauncher onOpenEditor={openInEditorWindow} />;
}

export default App;
