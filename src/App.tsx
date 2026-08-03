import RecorderLauncher from "./components/RecorderLauncher/RecorderLauncher";
import Editor from "./components/Editor/Editor";
import { useState } from "react";
import "./App.css";

function App() {
  const [editorVideo, setEditorVideo] = useState("");
  const [editorLog, setEditorLog] = useState("");

  if (editorVideo && editorLog) {
    return (
      <Editor
        videoPath={editorVideo}
        inputLogPath={editorLog}
        onClose={() => {
          setEditorVideo("");
          setEditorLog("");
        }}
      />
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
