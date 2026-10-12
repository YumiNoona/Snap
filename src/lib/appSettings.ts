export type BorderStyle = "off" | "red" | "dashed";
export type RecordingResolution = "native" | "1080p" | "720p";
export type RecordingPerformanceMode = "automatic" | "manual";

export interface AutomaticRecordingProfile {
  targetId: string;
  sourceWidth: number;
  sourceHeight: number;
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

export const AUTOMATIC_PROFILE_VERSION = 5;

export interface AppSettings {
  borderStyle: BorderStyle;
  countdown: boolean;
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
  minimizeWhileRecording: true,
  autoCheckUpdates: true,
  showRecordingDataFiles: false,
  recordingPerformanceMode: "automatic",
  recordingFps: 60,
  recordingBitrateMbps: 24,
  recordingResolution: "native",
  allowSoftwareEncoder: false,
  automaticRecordingProfile: null,
};

export function readAppSettings(): AppSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") as Partial<AppSettings>;
    const recordingPerformanceMode = stored.recordingPerformanceMode === "manual" ? "manual" : "automatic";
    const recordingFps = stored.recordingFps === 30 ? 30 : stored.recordingFps === 24 ? 24 : DEFAULT_SETTINGS.recordingFps;
    const recordingBitrateMbps = Math.round(Math.max(2, Math.min(50, Number(stored.recordingBitrateMbps) || DEFAULT_SETTINGS.recordingBitrateMbps)));
    const recordingResolution = stored.recordingResolution === "1080p" || stored.recordingResolution === "720p"
      ? stored.recordingResolution
      : DEFAULT_SETTINGS.recordingResolution;
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
      allowSoftwareEncoder: stored.allowSoftwareEncoder === true,
      automaticRecordingProfile,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeAppSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
