import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Cable,
  CheckCircle2,
  ChevronLeft,
  Download,
  HardDrive,
  LoaderCircle,
  MousePointerClick,
  AudioWaveform,
  MonitorSmartphone,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Square,
  Usb,
  Video,
  Volume2,
} from "lucide-react";
import { readAppSettings } from "../../lib/appSettings";
import { recordingDataPaths } from "../../lib/recordingPaths";
import "./DeviceView.css";

interface Props {
  onBack: () => void;
  onOpenEditor: (videoPath: string, logPath: string) => void;
}

interface MobileEnvironment {
  adbAvailable: boolean;
  scrcpyAvailable: boolean;
  ffmpegAvailable: boolean;
  wingetAvailable: boolean;
  androidDirectReady: boolean;
  iosDirectUsbSupported: boolean;
  androidDetail: string;
  iosDetail: string;
}

interface MobileDevice {
  id: string;
  name: string;
  platform: "android";
  state: string;
  transport: string;
  osVersion?: string;
  apiLevel?: number;
  audioSupported: boolean;
  detail: string;
}

interface CaptureSource {
  id: string;
  name: string;
  kind: "video" | "audio";
}

interface RecordingStatus {
  state: "idle" | "recording" | "stopping" | "finalizing" | "saved" | "recoverable" | "error";
  message: string;
  platform?: string;
  deviceId?: string;
  outputPath?: string;
  recoveryPath?: string;
  startedAtMs?: number;
  audioEnabled: boolean;
}

const idleStatus: RecordingStatus = {
  state: "idle",
  message: "Ready to record a mobile device.",
  audioEnabled: false,
};

function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${remaining.toString().padStart(2, "0")}`
    : `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

export default function DeviceView({ onBack, onOpenEditor }: Props) {
  const [platform, setPlatform] = useState<"none" | "android" | "ios">("none");
  const [environment, setEnvironment] = useState<MobileEnvironment | null>(null);
  const [devices, setDevices] = useState<MobileDevice[]>([]);
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [selectedVideo, setSelectedVideo] = useState("");
  const [selectedAudio, setSelectedAudio] = useState("");
  const [includeAudio, setIncludeAudio] = useState(true);
  const [status, setStatus] = useState<RecordingStatus>(idleStatus);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [actionError, setActionError] = useState("");
  const [recoveredPaths, setRecoveredPaths] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const openedOutputRef = useRef("");
  const appSettings = useMemo(() => readAppSettings(), []);

  const videoSources = useMemo(() => sources.filter((source) => source.kind === "video"), [sources]);
  const audioSources = useMemo(() => sources.filter((source) => source.kind === "audio"), [sources]);
  const currentDevice = useMemo(
    () => devices.find((device) => device.id === selectedDevice),
    [devices, selectedDevice],
  );
  const recordingActive = ["recording", "stopping", "finalizing"].includes(status.state);

  const refreshConnections = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    const [nextEnvironment, nextDevices, nextSources] = await Promise.all([
      invoke<MobileEnvironment>("mobile_environment"),
      invoke<MobileDevice[]>("enumerate_mobile_devices").catch(() => []),
      invoke<CaptureSource[]>("enumerate_mobile_capture_sources").catch(() => []),
    ]);
    setEnvironment(nextEnvironment);
    setDevices(nextDevices);
    setSources(nextSources);
    setSelectedDevice((current) => nextDevices.some((device) => device.id === current)
      ? current
      : nextDevices.find((device) => device.state === "device")?.id || nextDevices[0]?.id || "");
    setSelectedVideo((current) => nextSources.some((source) => source.kind === "video" && source.name === current)
      ? current
      : nextSources.find((source) => source.kind === "video")?.name || "");
    setSelectedAudio((current) => nextSources.some((source) => source.kind === "audio" && source.name === current)
      ? current
      : nextSources.find((source) => source.kind === "audio")?.name || "");
    setLoading(false);
  }, []);

  useEffect(() => {
    void (async () => {
      await refreshConnections(true);
      const [initialStatus, recovered] = await Promise.all([
        invoke<RecordingStatus>("mobile_recording_status").catch(() => idleStatus),
        invoke<string[]>("recover_mobile_recordings").catch(() => []),
      ]);
      setStatus(initialStatus);
      setRecoveredPaths(recovered);
    })();
  }, [refreshConnections]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void invoke<RecordingStatus>("mobile_recording_status").then(setStatus).catch(() => {});
    }, 600);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (recordingActive) return;
    const timer = window.setInterval(() => void refreshConnections(false), 3500);
    return () => window.clearInterval(timer);
  }, [recordingActive, refreshConnections]);

  useEffect(() => {
    if (!status.startedAtMs || !recordingActive) {
      setElapsed(0);
      return;
    }
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - status.startedAtMs!) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [recordingActive, status.startedAtMs]);

  useEffect(() => {
    if (status.state !== "saved" || !status.outputPath || !appSettings.autoOpenEditor) return;
    if (openedOutputRef.current === status.outputPath) return;
    openedOutputRef.current = status.outputPath;
    onOpenEditor(status.outputPath, recordingDataPaths(status.outputPath).logPath);
  }, [appSettings.autoOpenEditor, onOpenEditor, status.outputPath, status.state]);

  const installAndroidSupport = async () => {
    setInstalling(true);
    setActionError("");
    try {
      await invoke("install_android_capture_support");
      await refreshConnections(true);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setInstalling(false);
    }
  };

  const startRecording = async () => {
    setActionError("");
    try {
      if (platform === "android") {
        if (!environment?.androidDirectReady) throw new Error("Install Android capture support first.");
        if (!currentDevice || currentDevice.state !== "device") throw new Error("Select an authorized Android device.");
        if (includeAudio && !currentDevice.audioSupported) throw new Error("Device audio requires Android 11 or newer. Turn audio off to record video only.");
      } else if (platform === "ios") {
        if (!selectedVideo) throw new Error("Connect and select a UVC video capture input.");
        if (includeAudio && !selectedAudio) throw new Error("Select the capture adapter audio input or turn audio off.");
      } else {
        throw new Error("Select Android or iOS first.");
      }

      const videosDir = await invoke<string>("get_videos_dir");
      const outputPath = `${videosDir}\\snap_mobile_${Date.now()}.mp4`;
      openedOutputRef.current = "";
      const nextStatus = await invoke<RecordingStatus>("start_mobile_recording", {
        request: {
          platform,
          transport: platform === "android" ? "android_usb" : "capture_input",
          deviceId: currentDevice?.id || null,
          deviceName: currentDevice?.name || "iPhone / iPad",
          videoSource: platform === "ios" ? selectedVideo : null,
          audioSource: platform === "ios" ? selectedAudio : null,
          includeAudio,
          outputPath,
          showSupportFiles: appSettings.showRecordingDataFiles,
        },
      });
      setStatus(nextStatus);
    } catch (error) {
      setActionError(String(error));
    }
  };

  const stopRecording = async () => {
    setActionError("");
    try {
      setStatus((current) => ({ ...current, state: "stopping", message: "Stopping safely…" }));
      setStatus(await invoke<RecordingStatus>("stop_mobile_recording"));
    } catch (error) {
      setActionError(String(error));
    }
  };

  const openSavedRecording = (path = status.outputPath) => {
    if (!path) return;
    openedOutputRef.current = path;
    onOpenEditor(path, recordingDataPaths(path).logPath);
  };

  return (
    <div className="mobile-view">
      <header className="mobile-header" data-tauri-drag-region>
        <button className="mobile-back-button" onClick={platform === "none" ? onBack : () => setPlatform("none")} disabled={recordingActive}>
          <ChevronLeft size={17} /> {platform === "none" ? "Back" : "Platforms"}
        </button>
        <div className="mobile-heading-copy" data-tauri-drag-region>
          <h2 data-tauri-drag-region>Device capture</h2>
        </div>
        <button className="mobile-refresh-button" onClick={() => void refreshConnections(true)} disabled={loading || recordingActive} title="Refresh connected devices">
          <RefreshCw size={16} className={loading ? "mobile-spin" : ""} /> Refresh
        </button>
      </header>

      {recoveredPaths.length > 0 && (
        <div className="mobile-recovery-banner">
          <ShieldCheck size={18} />
          <span><strong>Recovered {recoveredPaths.length} interrupted recording{recoveredPaths.length === 1 ? "" : "s"}.</strong> Snap rebuilt the MP4 from its recovery container.</span>
          <button onClick={() => openSavedRecording(recoveredPaths[0])}>Open latest</button>
        </div>
      )}

      {platform === "none" ? (
        <main className="mobile-platform-picker">
          <div className="mobile-picker-hero">
            <div className="mobile-platform-intro">
              <span className="mobile-eyebrow">Mobile capture studio</span>
              <h3>Bring your phone screen<br />into Snap.</h3>
              <p>Record smooth device video and clean audio, then let Snap build editable zooms around real interactions.</p>
              <div className="mobile-feature-chips" aria-label="Mobile recording features">
                <span><MousePointerClick size={13} /> Auto Zoom</span>
                <span><AudioWaveform size={13} /> Separate audio</span>
                <span><ShieldCheck size={13} /> Recovery</span>
              </div>
            </div>

            <div className="mobile-hero-illustration" aria-hidden="true">
              <span className="mobile-orbit orbit-one" />
              <span className="mobile-orbit orbit-two" />
              <span className="mobile-hero-glow" />
              <span className="mobile-hero-phone">
                <span className="mobile-hero-phone-screen">
                  <i className="mobile-screen-wave wave-one" />
                  <i className="mobile-screen-wave wave-two" />
                  <i className="mobile-screen-focus" />
                </span>
                <i className="mobile-phone-speaker" />
                <i className="mobile-phone-home" />
              </span>
              <span className="mobile-hero-laptop"><i /></span>
              <span className="mobile-connection-path"><i /><i /><i /></span>
              <span className="mobile-floating-badge badge-zoom"><MousePointerClick size={14} /> 1.8×</span>
              <span className="mobile-floating-badge badge-audio"><AudioWaveform size={14} /></span>
            </div>
          </div>

          <div className="mobile-connection-heading">
            <div><span className="mobile-eyebrow">Choose a connection</span><h4>How is your phone connected?</h4></div>
            <p>Snap only enables workflows backed by a real Windows capture input.</p>
          </div>
          <div className="mobile-platform-grid">
            <button className="mobile-platform-card android" onClick={() => setPlatform("android")}>
              <span className="mobile-card-visual android-visual" aria-hidden="true">
                <span className="mini-phone"><i /></span>
                <span className="mini-cable"><i /></span>
                <Usb size={18} />
              </span>
              <span className="mobile-platform-card-copy">
                <span className="mobile-platform-title"><strong>Android USB</strong><i className={environment?.androidDirectReady ? "ready" : "setup"}>{environment?.androidDirectReady ? "Ready" : "Setup needed"}</i></span>
                <small>Direct low-latency capture, device audio, and real touch-driven Auto Zoom.</small>
                <span className="mobile-card-cta">Continue with Android <ChevronLeft size={14} /></span>
              </span>
            </button>
            <button className="mobile-platform-card ios" onClick={() => setPlatform("ios")}>
              <span className="mobile-card-visual ios-visual" aria-hidden="true">
                <span className="mini-phone ios"><i /></span>
                <span className="mini-adapter"><i /></span>
                <MonitorSmartphone size={18} />
              </span>
              <span className="mobile-platform-card-copy">
                <span className="mobile-platform-title"><strong>iPhone / iPad</strong><i className={videoSources.length > 0 ? "ready" : "setup"}>{videoSources.length > 0 ? `${videoSources.length} input${videoSources.length === 1 ? "" : "s"}` : "Capture input"}</i></span>
                <small>Reliable UVC video, adapter audio, and visual-activity Auto Zoom.</small>
                <span className="mobile-card-cta">Continue with Apple <ChevronLeft size={14} /></span>
              </span>
            </button>
          </div>
          <div className="mobile-safety-strip">
            <ShieldCheck size={19} />
            <div><strong>Recovery is always on</strong><small>Snap records to a resilient working container and maintains an atomic journal. A cable disconnect preserves everything received up to that point.</small></div>
          </div>
        </main>
      ) : (
        <main className="mobile-workspace">
          <section className="mobile-main-column">
            <div className="mobile-section-card">
              <div className="mobile-section-heading">
                <span className="mobile-section-icon">{platform === "android" ? <Usb size={18} /> : <Video size={18} />}</span>
                <div><h3>{platform === "android" ? "Android connection" : "Capture input"}</h3><p>{platform === "android" ? "Connect by USB, unlock the phone, and approve USB debugging." : "Connect the phone to an HDMI/USB capture adapter, then choose its Windows inputs."}</p></div>
              </div>

              {platform === "android" ? (
                <>
                  {!environment?.androidDirectReady && (
                    <div className="mobile-setup-callout">
                      <Download size={20} />
                      <div><strong>Android capture support is required</strong><small>Installs the official Genymobile scrcpy package through Windows Package Manager. It includes the matching ADB bridge.</small></div>
                      <button onClick={() => void installAndroidSupport()} disabled={installing || !environment?.wingetAvailable}>
                        {installing ? <LoaderCircle className="mobile-spin" size={15} /> : <Download size={15} />}
                        {installing ? "Installing…" : "Install"}
                      </button>
                    </div>
                  )}
                  <div className="mobile-device-list">
                    {devices.length === 0 ? (
                      <div className="mobile-empty-state"><Cable size={22} /><strong>No Android device found</strong><small>Enable Developer options and USB debugging, then reconnect with a data-capable cable.</small></div>
                    ) : devices.map((device) => (
                      <button key={device.id} className={`mobile-device-row ${selectedDevice === device.id ? "selected" : ""} ${device.state !== "device" ? "blocked" : ""}`} onClick={() => setSelectedDevice(device.id)}>
                        <span className="mobile-device-icon"><Smartphone size={19} /></span>
                        <span className="mobile-device-copy"><strong>{device.name}</strong><small>{device.detail}</small></span>
                        <span className={`mobile-device-state ${device.state}`}>{device.state === "device" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{device.state === "device" ? `Android ${device.osVersion || ""}` : device.state}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="mobile-source-grid">
                  <label><span><Video size={15} /> Video input</span><select value={selectedVideo} onChange={(event) => setSelectedVideo(event.target.value)}><option value="">Select a UVC capture input</option>{videoSources.map((source) => <option key={source.id} value={source.name}>{source.name}</option>)}</select></label>
                  <label><span><Volume2 size={15} /> Adapter audio</span><select value={selectedAudio} onChange={(event) => setSelectedAudio(event.target.value)} disabled={!includeAudio}><option value="">Select the adapter audio input</option>{audioSources.map((source) => <option key={source.id} value={source.name}>{source.name}</option>)}</select></label>
                  {videoSources.length === 0 && <div className="mobile-source-warning"><AlertTriangle size={17} /><span>No UVC capture input is visible. Reconnect the adapter and confirm it appears as a camera in Windows Settings.</span></div>}
                </div>
              )}
            </div>

            <div className="mobile-section-card">
              <div className="mobile-section-heading">
                <span className="mobile-section-icon"><Volume2 size={18} /></span>
                <div><h3>Recording</h3><p>Hardware H.264 video, editable device audio, and interaction-aware Auto Zoom.</p></div>
              </div>
              <label className="mobile-option-row">
                <span className="mobile-option-copy"><strong>Record device audio</strong><small>{platform === "android" ? "Captures phone output on Android 11+. Some protected apps can block audio." : "Captures the audio endpoint exposed by the USB adapter."}</small></span>
                <button type="button" role="switch" aria-checked={includeAudio} className={`mobile-switch ${includeAudio ? "on" : ""}`} onClick={() => setIncludeAudio((value) => !value)} disabled={recordingActive}><span /></button>
              </label>
              <div className="mobile-record-row">
                <button className={`mobile-record-button ${recordingActive ? "stop" : "start"}`} onClick={() => void (recordingActive ? stopRecording() : startRecording())} disabled={status.state === "stopping" || status.state === "finalizing" || installing}>
                  {recordingActive ? <Square size={15} fill="currentColor" /> : <span className="mobile-record-dot" />}
                  {status.state === "stopping" ? "Stopping…" : status.state === "finalizing" ? "Saving…" : recordingActive ? "Stop and save" : "Start recording"}
                </button>
                {recordingActive && <span className="mobile-elapsed"><i /> {formatElapsed(elapsed)}</span>}
                <span className="mobile-record-meta"><HardDrive size={14} /> Saves to Videos\Snap with continuous recovery</span>
              </div>
            </div>

            {(actionError || status.state !== "idle") && (
              <div className={`mobile-status-panel ${actionError ? "error" : status.state}`}>
                {actionError || status.state === "recoverable" || status.state === "error" ? <AlertTriangle size={19} /> : status.state === "saved" ? <CheckCircle2 size={19} /> : <LoaderCircle className={recordingActive ? "mobile-spin" : ""} size={19} />}
                <div><strong>{actionError ? "Unable to start recording" : status.state === "saved" ? "Recording saved" : status.state === "recoverable" ? "Recording is recoverable" : status.state === "recording" ? "Recording mobile device" : "Finishing recording"}</strong><small>{actionError || status.message}</small>{status.recoveryPath && status.state === "recoverable" && <code>{status.recoveryPath}</code>}</div>
                {status.state === "saved" && status.outputPath && <button onClick={() => openSavedRecording()}>Open editor</button>}
              </div>
            )}
          </section>

          <aside className="mobile-guide-column">
            <div className="mobile-guide-card">
              <span className="mobile-eyebrow">{platform === "android" ? "Android checklist" : "iPhone / iPad checklist"}</span>
              <h3>{platform === "android" ? "Authorize USB capture" : "Connect the capture adapter"}</h3>
              <ol>
                {platform === "android" ? (
                  <>
                    <li><span>1</span><div><strong>Enable Developer options</strong><small>Tap Build number seven times in About phone.</small></div></li>
                    <li><span>2</span><div><strong>Turn on USB debugging</strong><small>Use a data-capable USB cable and keep the phone unlocked.</small></div></li>
                    <li><span>3</span><div><strong>Approve this computer</strong><small>Accept the RSA prompt. Snap reports “unauthorized” until approved.</small></div></li>
                    <li><span>4</span><div><strong>Confirm audio support</strong><small>Android 11+ is required; protected apps may still opt out.</small></div></li>
                  </>
                ) : (
                  <>
                    <li><span>1</span><div><strong>Connect video output</strong><small>Use the appropriate Apple HDMI/USB-C adapter for your device.</small></div></li>
                    <li><span>2</span><div><strong>Connect a UVC capture adapter</strong><small>Windows should expose it as a camera and audio input.</small></div></li>
                    <li><span>3</span><div><strong>Select matching inputs</strong><small>Choose the adapter’s video and audio endpoints above.</small></div></li>
                    <li><span>4</span><div><strong>Keep the phone powered</strong><small>Long sessions are safer when the phone and adapter have power passthrough.</small></div></li>
                  </>
                )}
              </ol>
            </div>
            <div className="mobile-resilience-card"><ShieldCheck size={20} /><div><strong>Recovery and Auto Zoom data</strong><small>Snap preserves every received media packet, extracts device audio as an editable track, and records Android touch points for Auto Zoom. iPhone/iPad capture uses localized visual activity because Windows UVC does not expose touch events.</small></div></div>
            {platform === "ios" && <div className="mobile-platform-note"><AlertTriangle size={17} /><span>Direct iPhone screen mirroring over a normal USB cable is not exposed to Windows by Apple. Snap only presents the capture-adapter workflow so the Record button always maps to a real input.</span></div>}
          </aside>
        </main>
      )}
    </div>
  );
}
