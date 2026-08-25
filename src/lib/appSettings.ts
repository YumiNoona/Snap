export type BorderStyle = "off" | "red" | "dashed";
export type RecordingResolution = "native" | "1080p" | "720p";
export type RecordingPerformanceMode = "automatic" | "manual";

export interface AutomaticRecordingProfile {
  version: number;
  calibratedAt: number;
  summary: string;
  encoder: string;
  hardwareEncoding: boolean;
  options: {
    fps: 24 | 30 | 60;
    bitrateMbps: number;
    maxWidth: number | null;
    maxHeight: number | null;
    allowSoftwareEncoder: boolean;
  };
}

export const AUTOMATIC_PROFILE_VERSION = 2;

export interface AppSettings {
  borderStyle: BorderStyle;
  countdown: boolean;
  autoOpenEditor: boolean;
  minimizeWhileRecording: boolean;
  autoCheckUpdates: boolean;
  showRecordingDataFiles: boolean;
  recordingPerformanceMode: RecordingPerformanceMode;
  recordingFps: 24 | 30 | 60;
  recordingBitrateMbps: number;
  recordingResolution: RecordingResolution;
  allowSoftwareEncoder: boolean;
  automaticRecordingProfile: AutomaticRecordingProfile | null;
}

export const SETTINGS_KEY = "snap.settings";

export const DEFAULT_SETTINGS: AppSettings = {
  borderStyle: "off",
  countdown: true,
  autoOpenEditor: true,
  minimizeWhileRecording: true,
  autoCheckUpdates: true,
  showRecordingDataFiles: false,
  recordingPerformanceMode: "automatic",
  recordingFps: 30,
  recordingBitrateMbps: 8,
  recordingResolution: "1080p",
  allowSoftwareEncoder: true,
  automaticRecordingProfile: null,
};

export function readAppSettings(): AppSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as Partial<AppSettings>;
    const recordingPerformanceMode = stored.recordingPerformanceMode === "manual" ? "manual" : "automatic";
    const recordingFps = stored.recordingFps === 60 ? 60 : stored.recordingFps === 24 ? 24 : 30;
    const recordingBitrateMbps = Math.round(Math.max(2, Math.min(50, Number(stored.recordingBitrateMbps) || DEFAULT_SETTINGS.recordingBitrateMbps)));
    const recordingResolution = stored.recordingResolution === "native" || stored.recordingResolution === "720p"
      ? stored.recordingResolution
      : "1080p";
    const profile = stored.automaticRecordingProfile;
    const automaticRecordingProfile = profile
      && profile.version === AUTOMATIC_PROFILE_VERSION
      && [24, 30, 60].includes(profile.options?.fps)
      && Number.isFinite(profile.options?.bitrateMbps)
      && typeof profile.summary === "string"
      ? profile
      : null;
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      recordingPerformanceMode,
      recordingFps,
      recordingBitrateMbps,
      recordingResolution,
      allowSoftwareEncoder: stored.allowSoftwareEncoder !== false,
      automaticRecordingProfile,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeAppSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
