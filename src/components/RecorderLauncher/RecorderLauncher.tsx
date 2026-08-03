import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./RecorderLauncher.css";

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <line x1="2" y1="6" x2="10" y2="6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <line x1="2" y1="2" x2="10" y2="10" />
      <line x1="10" y1="2" x2="2" y2="10" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
      <rect x="2" y="2" width="8" height="8" rx="1" />
    </svg>
  );
}

function FullScreenIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="6" width="40" height="28" rx="3" />
      <line x1="8" y1="38" x2="40" y2="38" />
      <line x1="24" y1="38" x2="24" y2="42" />
      <line x1="14" y1="42" x2="34" y2="42" />
    </svg>
  );
}

function CustomIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="10" y="8" width="28" height="32" rx="2" />
      <line x1="10" y1="16" x2="20" y2="8" />
      <line x1="18" y1="38" x2="28" y2="14" />
      <line x1="38" y1="16" x2="38" y2="40" />
      <circle cx="30" cy="26" r="2" fill="currentColor" />
      <circle cx="16" cy="30" r="2" fill="currentColor" />
    </svg>
  );
}

function WindowIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="8" width="38" height="32" rx="3" />
      <line x1="5" y1="18" x2="43" y2="18" />
      <circle cx="13" cy="13" r="1.5" fill="currentColor" />
      <circle cx="18.5" cy="13" r="1.5" fill="currentColor" />
      <circle cx="24" cy="13" r="1.5" fill="currentColor" />
    </svg>
  );
}

function DeviceIcon() {
  return (
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="10" width="32" height="24" rx="3" />
      <circle cx="20" cy="22" r="3" />
      <path d="M20 22 L20 10" />
      <rect x="16" y="36" width="8" height="2" rx="1" />
      <rect x="38" y="14" width="6" height="16" rx="1" />
      <line x1="41" y1="18" x2="41" y2="26" strokeWidth="3" />
    </svg>
  );
}

interface ModeCardProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

function ModeCard({ icon, label, onClick }: ModeCardProps) {
  return (
    <button className="mode-card" onClick={onClick}>
      <div className="mode-card-icon">{icon}</div>
      <span className="mode-card-label">{label}</span>
    </button>
  );
}

interface Props {
  onOpenEditor: (videoPath: string, logPath: string) => void;
}

export default function RecorderLauncher({ onOpenEditor }: Props) {
  const [testStatus, setTestStatus] = useState("");
  const [audioTestStatus, setAudioTestStatus] = useState("");
  const [inputTestStatus, setInputTestStatus] = useState("");
  const [combinedStatus, setCombinedStatus] = useState("");
  const [lastVideo, setLastVideo] = useState("");
  const [lastLog, setLastLog] = useState("");
  const appWindow = getCurrentWindow();
  console.log("[Snap UI] getCurrentWindow() returned:", appWindow);

  const handleModeClick = (mode: string) => {
    console.log(`Selected mode: ${mode}`);
  };

  const handleTestRecord = async () => {
    setTestStatus("Enumerating targets...");
    try {
      const targets = await invoke<Array<{ id: string; name: string; target_type: string }>>("enumerate_targets");

      const primaryMonitor = targets.find((t) => t.target_type === "monitor");
      if (!primaryMonitor) {
        setTestStatus("ERROR: No monitor found");
        return;
      }

      const videosDir = await invoke<string>("get_videos_dir");
      const outputPath = `${videosDir}\\snap_test_${Date.now()}.mp4`;

      setTestStatus(`Recording to ${outputPath}...`);
      await invoke("start_recording", { targetId: primaryMonitor.id, outputPath });

      setTestStatus("Recording... waiting 5s");
      await new Promise((resolve) => setTimeout(resolve, 5000));

      setTestStatus("Stopping...");
      await invoke("stop_recording");

      setTestStatus(`SUCCESS: Saved to ${outputPath}`);
      console.log(`Recording saved to ${outputPath}`);
    } catch (e) {
      setTestStatus(`ERROR: ${e}`);
      console.error("Test record failed:", e);
    }
  };

  const handleTestAudio = async () => {
    setAudioTestStatus("Starting audio capture...");
    try {
      const videosDir = await invoke<string>("get_videos_dir");
      const outputDir = `${videosDir}\\snap_audio_test_${Date.now()}`;

      setAudioTestStatus(`Capturing to ${outputDir}...`);
      await invoke("start_audio_capture", { micDeviceId: "default", outputDir });

      setAudioTestStatus("Recording audio... waiting 5s");
      await new Promise((resolve) => setTimeout(resolve, 5000));

      setAudioTestStatus("Stopping...");
      await invoke("stop_audio_capture");

      setAudioTestStatus(
        `SUCCESS: system_audio.pcm + mic_audio.pcm saved to ${outputDir}`
      );
    } catch (e) {
      setAudioTestStatus(`ERROR: ${e}`);
      console.error("Test audio failed:", e);
    }
  };

  const handleTestInput = async () => {
    setInputTestStatus("Starting input logging...");
    try {
      const videosDir = await invoke<string>("get_videos_dir");
      const outputPath = `${videosDir}\\input_log_${Date.now()}.jsonl`;

      setInputTestStatus(`Logging to ${outputPath}...`);
      await invoke("start_input_logging", {
        outputPath,
        sessionStartTime: String(Date.now()),
      });

      setInputTestStatus("Logging input... move mouse, type, click (5s)");
      await new Promise((resolve) => setTimeout(resolve, 5000));

      setInputTestStatus("Stopping...");
      const count = await invoke<number>("stop_input_logging");

      setInputTestStatus(
        `SUCCESS: ${count} events logged to ${outputPath}`
      );
    } catch (e) {
      setInputTestStatus(`ERROR: ${e}`);
      console.error("Test input failed:", e);
    }
  };

  const handleTestCombined = async () => {
    setCombinedStatus("Starting video + input recording...");
    try {
      const targets = await invoke<Array<{ id: string; name: string; target_type: string }>>("enumerate_targets");
      const primaryMonitor = targets.find((t) => t.target_type === "monitor");
      if (!primaryMonitor) { setCombinedStatus("ERROR: No monitor found"); return; }

      const videosDir = await invoke<string>("get_videos_dir");
      const stamp = Date.now();
      const videoPath = `${videosDir}\\snap_combined_${stamp}.mp4`;
      const logPath = `${videosDir}\\snap_combined_${stamp}.jsonl`;

      setCombinedStatus("Starting video capture...");
      await invoke("start_recording", { targetId: primaryMonitor.id, outputPath: videoPath });

      setCombinedStatus("Starting input logging (aligned timestamp)...");
      // session_start_time = 0 means log timestamps are relative to logging start.
      // Video also starts at ~0, so both timelines align.
      await invoke("start_input_logging", { outputPath: logPath, sessionStartTime: "0" });

      setCombinedStatus("Recording video + input... waiting 5s");
      await new Promise((resolve) => setTimeout(resolve, 5000));

      setCombinedStatus("Stopping...");
      await invoke("stop_recording");
      const eventCount = await invoke<number>("stop_input_logging");

      setLastVideo(videoPath);
      setLastLog(logPath);
      setCombinedStatus(`SUCCESS: video + ${eventCount} events`);
    } catch (e) {
      setCombinedStatus(`ERROR: ${e}`);
    }
  };

  return (
    <div className="app-layout">
      <header className="titlebar">
        <div
          className="titlebar-drag-area"
          onMouseDown={async (e) => {
            e.preventDefault();
            await appWindow.startDragging();
          }}
        />
        <div className="titlebar-left">
          <span className="app-name">Snap</span>
          <span className="menu-item">File</span>
        </div>

        <div className="titlebar-right">
          <button className="titlebar-icon" title="Settings">
            <SettingsIcon />
          </button>
          <button
            className="window-btn"
            title="Minimize"
            onClick={() => {
              console.log("minimize clicked");
              appWindow.minimize();
            }}
          >
            <MinimizeIcon />
          </button>
          <button
            className="window-btn"
            title="Maximize"
            onClick={() => {
              console.log("maximize clicked");
              appWindow.toggleMaximize();
            }}
          >
            <MaximizeIcon />
          </button>
          <button
            className="window-btn close-btn"
            title="Close"
            onClick={() => {
              console.log("close clicked");
              appWindow.close();
            }}
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      <div className="main-content">
        <div className="recording-modes">
          <h2>Please select the recording mode</h2>
          <div className="mode-cards">
            <ModeCard
              icon={<FullScreenIcon />}
              label="Full Screen"
              onClick={() => handleModeClick("fullscreen")}
            />
            <ModeCard
              icon={<CustomIcon />}
              label="Custom"
              onClick={() => handleModeClick("custom")}
            />
            <ModeCard
              icon={<WindowIcon />}
              label="Window"
              onClick={() => handleModeClick("window")}
            />
            <ModeCard
              icon={<DeviceIcon />}
              label="Device"
              onClick={() => handleModeClick("device")}
            />
          </div>

          <div style={{ marginTop: 24, textAlign: "center", display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <div>
              <button
                onClick={handleTestRecord}
                disabled={testStatus.includes("...")}
                style={{
                  padding: "10px 24px",
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid var(--border-default)",
                  background: testStatus.startsWith("SUCCESS")
                    ? "#1a3a2a"
                    : testStatus.startsWith("ERROR")
                      ? "#3a1a1a"
                      : "var(--bg-tertiary)",
                  color: testStatus.startsWith("SUCCESS")
                    ? "#4ade80"
                    : testStatus.startsWith("ERROR")
                      ? "#f87171"
                      : "var(--accent)",
                  cursor: testStatus.includes("...") ? "not-allowed" : "pointer",
                }}
              >
                TEST RECORD 5s
              </button>
              {testStatus && (
                <p
                  style={{
                    marginTop: 12,
                    fontSize: 12,
                    color: testStatus.startsWith("SUCCESS")
                      ? "#4ade80"
                      : testStatus.startsWith("ERROR")
                        ? "#f87171"
                        : "var(--text-secondary)",
                    wordBreak: "break-all",
                    maxWidth: 400,
                  }}
                >
                  {testStatus}
                </p>
              )}
            </div>
            <div>
              <button
                onClick={handleTestAudio}
                disabled={audioTestStatus.includes("...")}
                style={{
                  padding: "10px 24px",
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid var(--border-default)",
                  background: audioTestStatus.startsWith("SUCCESS")
                    ? "#1a3a2a"
                    : audioTestStatus.startsWith("ERROR")
                      ? "#3a1a1a"
                      : "var(--bg-tertiary)",
                  color: audioTestStatus.startsWith("SUCCESS")
                    ? "#4ade80"
                    : audioTestStatus.startsWith("ERROR")
                      ? "#f87171"
                      : "var(--accent)",
                  cursor: audioTestStatus.includes("...") ? "not-allowed" : "pointer",
                }}
              >
                TEST AUDIO 5s
              </button>
              {audioTestStatus && (
                <p
                  style={{
                    marginTop: 12,
                    fontSize: 12,
                    color: audioTestStatus.startsWith("SUCCESS")
                      ? "#4ade80"
                      : audioTestStatus.startsWith("ERROR")
                        ? "#f87171"
                        : "var(--text-secondary)",
                    wordBreak: "break-all",
                    maxWidth: 400,
                  }}
                >
                  {audioTestStatus}
                </p>
              )}
            </div>
            <div>
              <button
                onClick={handleTestInput}
                disabled={inputTestStatus.includes("...")}
                style={{
                  padding: "10px 24px",
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid var(--border-default)",
                  background: inputTestStatus.startsWith("SUCCESS")
                    ? "#1a3a2a"
                    : inputTestStatus.startsWith("ERROR")
                      ? "#3a1a1a"
                      : "var(--bg-tertiary)",
                  color: inputTestStatus.startsWith("SUCCESS")
                    ? "#4ade80"
                    : inputTestStatus.startsWith("ERROR")
                      ? "#f87171"
                      : "var(--accent)",
                  cursor: inputTestStatus.includes("...") ? "not-allowed" : "pointer",
                }}
              >
                TEST INPUT 5s
              </button>
              {inputTestStatus && (
                <p
                  style={{
                    marginTop: 12,
                    fontSize: 12,
                    color: inputTestStatus.startsWith("SUCCESS")
                      ? "#4ade80"
                      : inputTestStatus.startsWith("ERROR")
                        ? "#f87171"
                        : "var(--text-secondary)",
                    wordBreak: "break-all",
                    maxWidth: 400,
                  }}
                >
                  {inputTestStatus}
                </p>
              )}
            </div>
            <div>
              <button
                onClick={handleTestCombined}
                disabled={combinedStatus.includes("...")}
                style={{
                  padding: "10px 24px",
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid var(--border-default)",
                  background: combinedStatus.startsWith("SUCCESS")
                    ? "#1a3a2a"
                    : combinedStatus.startsWith("ERROR")
                      ? "#3a1a1a"
                      : "var(--bg-tertiary)",
                  color: combinedStatus.startsWith("SUCCESS")
                    ? "#4ade80"
                    : combinedStatus.startsWith("ERROR")
                      ? "#f87171"
                      : "var(--accent)",
                  cursor: combinedStatus.includes("...") ? "not-allowed" : "pointer",
                }}
              >
                TEST COMBINED 5s
              </button>
              {combinedStatus && (
                <p
                  style={{
                    marginTop: 12,
                    fontSize: 12,
                    color: combinedStatus.startsWith("SUCCESS")
                      ? "#4ade80"
                      : combinedStatus.startsWith("ERROR")
                        ? "#f87171"
                        : "var(--text-secondary)",
                    wordBreak: "break-all",
                    maxWidth: 400,
                  }}
                >
                  {combinedStatus}
                </p>
              )}
            </div>
          </div>

          {lastVideo && lastLog && (
            <div style={{ marginTop: 16, textAlign: "center" }}>
              <button
                onClick={() => onOpenEditor(lastVideo, lastLog)}
                style={{
                  padding: "10px 24px",
                  fontSize: 14,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid var(--border-default)",
                  background: "var(--bg-tertiary)",
                  color: "#facc15",
                  cursor: "pointer",
                }}
              >
                Open Editor (last recording)
              </button>
            </div>
          )}
        </div>

        <aside className="device-panel">
          <h3>Device &amp; Tool</h3>

          <div className="device-field">
            <label htmlFor="video-device">Video Device</label>
            <select id="video-device" defaultValue="">
              <option value="" disabled>
                Select a video device
              </option>
              <option value="screen">Screen Capture</option>
            </select>
          </div>

          <div className="device-field">
            <label htmlFor="microphone">Microphone</label>
            <select id="microphone" defaultValue="">
              <option value="" disabled>
                Select a microphone
              </option>
              <option value="default">Default Microphone</option>
            </select>
          </div>

          <div className="device-field">
            <label htmlFor="speaker">Speaker Output</label>
            <select id="speaker" defaultValue="">
              <option value="" disabled>
                Select speaker output
              </option>
              <option value="default">Default Speaker</option>
            </select>
          </div>

          <button
            className="teleprompter-btn"
            onClick={() => console.log("Teleprompter clicked")}
          >
            Teleprompter
          </button>
        </aside>
      </div>
    </div>
  );
}
