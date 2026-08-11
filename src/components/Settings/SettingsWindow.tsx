import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Database,
  Frame,
  Minimize2,
  Minus,
  PanelTopOpen,
  RefreshCw,
  Timer,
  WandSparkles,
  X,
} from "lucide-react";
import {
  type AppSettings,
  type BorderStyle,
  readAppSettings,
  writeAppSettings,
} from "../../lib/appSettings";
import snapAppIcon from "../../../src-tauri/icons/snap.png";
import "./SettingsWindow.css";

type UpdateState = "idle" | "checking" | "available" | "current" | "downloading" | "installing" | "error";

function SettingsToggle({ icon, title, description, checked, onChange }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="settings-option-card">
      <span className="settings-option-icon">{icon}</span>
      <span className="settings-option-copy"><strong>{title}</strong><small>{description}</small></span>
      <button className={`toggle-switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)} role="switch" aria-checked={checked} aria-label={title}>
        <span className="toggle-knob" />
      </button>
    </div>
  );
}

export default function SettingsWindow() {
  const [tab, setTab] = useState<"recording" | "updates">("recording");
  const [settings, setSettings] = useState<AppSettings>(readAppSettings);
  const [installedVersion, setInstalledVersion] = useState("0.1.0");
  const [updateState, setUpdateState] = useState<UpdateState>("idle");
  const [updateMessage, setUpdateMessage] = useState("Check GitHub for the latest version of Snap.");
  const [updateVersion, setUpdateVersion] = useState("");
  const [updateNotes, setUpdateNotes] = useState("");
  const [updateProgress, setUpdateProgress] = useState(0);
  const pendingUpdateRef = useRef<Awaited<ReturnType<typeof check>>>(null);
  const updateCheckRef = useRef(false);

  useEffect(() => {
    getVersion().then(setInstalledVersion).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      writeAppSettings(settings);
      void emit("settings-changed", settings).catch(() => {});
    } catch {
      // Preferences remain active for this session if persistent storage is unavailable.
    }
  }, [settings]);

  useEffect(() => {
    void invoke("organize_recording_data", { showSupportFiles: settings.showRecordingDataFiles }).catch(() => {});
  }, [settings.showRecordingDataFiles]);

  const checkForUpdates = async () => {
    if (updateCheckRef.current || updateState === "downloading" || updateState === "installing") return;
    updateCheckRef.current = true;
    setUpdateState("checking");
    setUpdateMessage("Checking GitHub Releases…");
    setUpdateProgress(0);
    try {
      const update = await check({ timeout: 20_000 });
      pendingUpdateRef.current = update;
      if (update) {
        setUpdateVersion(update.version);
        setUpdateNotes(update.body || "A new version of Snap is ready to install.");
        setUpdateState("available");
        setUpdateMessage(`Snap ${update.version} is available.`);
      } else {
        setUpdateVersion("");
        setUpdateNotes("");
        setUpdateState("current");
        setUpdateMessage(`Snap ${installedVersion} is up to date.`);
      }
    } catch (error) {
      pendingUpdateRef.current = null;
      setUpdateState("error");
      setUpdateMessage(`Could not check for updates: ${String(error)}`);
    } finally {
      updateCheckRef.current = false;
    }
  };

  const downloadAndInstallUpdate = async () => {
    if (!pendingUpdateRef.current) {
      await checkForUpdates();
      return;
    }
    const update = pendingUpdateRef.current;
    let downloaded = 0;
    let total = 0;
    setUpdateState("downloading");
    setUpdateMessage(`Downloading Snap ${update.version}…`);
    setUpdateProgress(0);
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength || 0;
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (total > 0) setUpdateProgress(Math.min(99, Math.round((downloaded / total) * 100)));
        }
        if (event.event === "Finished") {
          setUpdateProgress(100);
          setUpdateState("installing");
          setUpdateMessage("Installing update and restarting Snap…");
        }
      });
      await relaunch();
    } catch (error) {
      setUpdateState("error");
      setUpdateMessage(`Update failed: ${String(error)}`);
    }
  };

  const change = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="settings-window">
      <header className="settings-titlebar" data-tauri-drag-region>
        <div className="settings-window-brand" data-tauri-drag-region><img className="settings-app-icon" src={snapAppIcon} alt="" aria-hidden="true" /><strong>Snap Settings</strong></div>
        <div className="settings-window-controls">
          <button title="Minimize" onClick={() => getCurrentWindow().minimize()}><Minus size={15} /></button>
          <button title="Close" onClick={() => getCurrentWindow().close()}><X size={15} /></button>
        </div>
      </header>

      <main className="settings-window-content">
        <div className="settings-window-heading">
          <h1>Settings</h1>
          <p>Recording preferences and app updates</p>
        </div>

        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          <button className={tab === "recording" ? "active" : ""} onClick={() => setTab("recording")}><WandSparkles size={15} />Recording</button>
          <button className={tab === "updates" ? "active" : ""} onClick={() => setTab("updates")}><RefreshCw size={15} />Updates{updateState === "available" && <i />}</button>
        </div>

        <div className="settings-scroll-area">
          {tab === "recording" ? (
            <>
              <section className="settings-section">
                <div className="settings-section-title"><Frame size={15} /><span>Recording border</span></div>
                <div className="border-choice-grid">
                  {(["off", "red", "dashed"] as BorderStyle[]).map((style) => (
                    <button key={style} className={`border-choice ${settings.borderStyle === style ? "active" : ""}`} onClick={() => change("borderStyle", style)}>
                      <span className={`border-choice-preview ${style}`}><i /></span>
                      <span>{style === "off" ? "None" : style === "red" ? "Red" : "Dashed"}</span>
                    </button>
                  ))}
                </div>
              </section>
              <div className="settings-options-stack">
                <SettingsToggle icon={<Timer size={18} />} title="3–2–1 countdown" description="Give yourself time before recording starts" checked={settings.countdown} onChange={(value) => change("countdown", value)} />
                <SettingsToggle icon={<Minimize2 size={18} />} title="Minimize while recording" description="Keep the launcher out of your capture" checked={settings.minimizeWhileRecording} onChange={(value) => change("minimizeWhileRecording", value)} />
                <SettingsToggle icon={<PanelTopOpen size={18} />} title="Open editor after recording" description="Open the finished recording automatically" checked={settings.autoOpenEditor} onChange={(value) => change("autoOpenEditor", value)} />
                <SettingsToggle icon={<Database size={18} />} title="Show audio and JSON files" description="Reveal Snap’s per-recording working-data folders in Videos" checked={settings.showRecordingDataFiles} onChange={(value) => change("showRecordingDataFiles", value)} />
              </div>
            </>
          ) : (
            <div className="updates-settings-panel">
              <div className={`update-status-hero ${updateState}`}>
                <span className="update-status-icon">
                  {updateState === "checking" || updateState === "downloading" || updateState === "installing" ? <RefreshCw size={21} className="spin" /> : updateState === "error" ? <AlertCircle size={21} /> : <CheckCircle2 size={21} />}
                </span>
                <span><strong>{updateState === "available" ? `Snap ${updateVersion}` : updateState === "current" ? "You’re up to date" : updateState === "error" ? "Update check failed" : updateState === "downloading" || updateState === "installing" ? "Updating Snap" : "Snap updates"}</strong><small>{updateMessage}</small></span>
              </div>
              {(updateState === "downloading" || updateState === "installing") && <div className="update-progress"><i style={{ width: `${updateProgress}%` }} /><span>{updateProgress}%</span></div>}
              {updateState === "available" && updateNotes && <p className="update-release-notes">{updateNotes}</p>}
              <div className="update-actions">
                <span>Installed version {installedVersion}</span>
                {updateState === "available" ? <button className="update-primary-btn" onClick={() => void downloadAndInstallUpdate()}><Download size={15} />Download & install</button> : <button className="update-check-btn" disabled={updateState === "checking" || updateState === "downloading" || updateState === "installing"} onClick={() => void checkForUpdates()}><RefreshCw size={15} />Check for updates</button>}
              </div>
              <SettingsToggle icon={<RefreshCw size={18} />} title="Automatic update checks" description="Notify you when a new GitHub release is ready" checked={settings.autoCheckUpdates} onChange={(value) => change("autoCheckUpdates", value)} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
