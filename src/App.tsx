import React, { useState } from "react";
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

function App() {
  const [editorVideo, setEditorVideo] = useState("");
  const [editorLog, setEditorLog] = useState("");

  const resetEditor = () => {
    setEditorVideo("");
    setEditorLog("");
  };

  if (editorVideo && editorLog) {
    return (
      <ErrorBoundary onReset={resetEditor}>
        <Editor
          videoPath={editorVideo}
          inputLogPath={editorLog}
          onClose={resetEditor}
        />
      </ErrorBoundary>
    );
  }

  return (
    <RecorderLauncher
      onOpenEditor={(video: string, log: string) => {
        setEditorVideo(video);
        setEditorLog(log);
      }}
    />
  );
}

export default App;
