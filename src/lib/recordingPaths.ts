export interface RecordingDataPaths {
  dataDir: string;
  logPath: string;
}

export function recordingStem(videoPath: string): string {
  const slash = Math.max(videoPath.lastIndexOf("\\"), videoPath.lastIndexOf("/"));
  return videoPath.slice(slash + 1).replace(/\.[^/.]+$/, "");
}

export function recordingParent(videoPath: string): string {
  const slash = Math.max(videoPath.lastIndexOf("\\"), videoPath.lastIndexOf("/"));
  return slash >= 0 ? videoPath.slice(0, slash) : ".";
}

export function recordingDataPaths(videoPath: string): RecordingDataPaths {
  const dataDir = `${recordingParent(videoPath)}\\${recordingStem(videoPath)}`;
  return { dataDir, logPath: `${dataDir}\\events.json` };
}
