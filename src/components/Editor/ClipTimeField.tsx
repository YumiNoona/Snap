import { useEffect, useState } from "react";
import { formatClipTime } from "../../lib/autoClips";
export function parseClipTime(value: string): number | null {
  const parts = value.trim().split(":");
  if (
    parts.length < 1 ||
    parts.length > 3 ||
    parts.some((p) => !/^\d+(?:\.\d+)?$/.test(p))
  )
    return null;
  if (parts.slice(1).some((p) => Number(p) >= 60)) return null;
  const seconds = parts.reduce((total, p) => total * 60 + Number(p), 0);
  return Number.isFinite(seconds) ? seconds : null;
}
export default function ClipTimeField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const [draft, setDraft] = useState(formatClipTime(value)),
    [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(formatClipTime(value));
    setInvalid(false);
  }, [value]);
  const commit = () => {
    const next = parseClipTime(draft);
    if (next === null) {
      setInvalid(true);
      return;
    }
    const clamped = Math.max(min, Math.min(max, next));
    onChange(clamped);
    setDraft(formatClipTime(clamped));
    setInvalid(false);
  };
  return (
    <label className="ac-time-field">
      {label}
      <input
        aria-label={label}
        type="text"
        value={draft}
        aria-invalid={invalid || undefined}
        spellCheck={false}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setDraft(formatClipTime(value));
            setInvalid(false);
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            onChange(
              Math.max(
                min,
                Math.min(
                  max,
                  value +
                    (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 1 : 0.1),
                ),
              ),
            );
          }
        }}
      />
      {invalid && <small role="alert">Use m:ss or seconds.</small>}
    </label>
  );
}
