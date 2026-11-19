export const EDITION = import.meta.env.VITE_SNAP_EDITION || "full";
export const RECORDER_ONLY = EDITION === "recorder";
export const EDITOR_ONLY = EDITION === "editor";
