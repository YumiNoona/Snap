export type BorderStyle = "off" | "red" | "dashed";

export interface AppSettings {
  borderStyle: BorderStyle;
  countdown: boolean;
  autoOpenEditor: boolean;
  minimizeWhileRecording: boolean;
  autoCheckUpdates: boolean;
  showRecordingDataFiles: boolean;
}

export const SETTINGS_KEY = "snap.settings";

export const DEFAULT_SETTINGS: AppSettings = {
  borderStyle: "red",
  countdown: true,
  autoOpenEditor: true,
  minimizeWhileRecording: true,
  autoCheckUpdates: true,
  showRecordingDataFiles: false,
};

export function readAppSettings(): AppSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeAppSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
