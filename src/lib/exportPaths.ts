export function pathFileName(path: string): string {
  const slash = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return path.slice(slash + 1);
}

export function recordingExportDirectory(videoPath: string): string {
  const slash = Math.max(videoPath.lastIndexOf("\\"), videoPath.lastIndexOf("/"));
  const separator = videoPath.includes("\\") ? "\\" : "/";
  const parent = slash >= 0 ? videoPath.slice(0, slash) : ".";
  return `${parent}${separator}Exports`;
}

export function defaultExportPath(videoPath: string, exportDirectory: string, suffix: string, format: "mp4" | "webm" | "gif"): string {
  const sourceName = pathFileName(videoPath).replace(/\.[^/.]+$/, "") || "snap";
  const cleanSuffix = suffix.replace(/[^a-z0-9_-]/gi, "_") || "edited";
  const separator = exportDirectory.includes("\\") ? "\\" : "/";
  return `${exportDirectory.replace(/[\\/]$/, "")}${separator}${sourceName}_${cleanSuffix}.${format}`;
}
