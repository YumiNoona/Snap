import type { ReactNode } from "react";
import "./Slider.css";

interface SliderProps {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
  onReset?: () => void;
  defaultValue?: number;
  disabled?: boolean;
  compact?: boolean;
}

export default function Slider({ label, value, min, max, step = 1, unit = "", onChange, onReset, defaultValue, disabled, compact }: SliderProps) {
  const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const isDifferent = defaultValue !== undefined && value !== defaultValue;

  return (
    <div className={`slider-row${compact ? " compact" : ""}${disabled ? " disabled" : ""}`}>
      {label && <span className="slider-label">{label}</span>}
      <div className="slider-track-wrap">
        <input
          type="range"
          className="slider-input"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
          disabled={disabled}
        />
        <div className="slider-track" />
        <div className="slider-fill" style={{ width: `${percent}%`, opacity: disabled ? 0.3 : 1 }} />
        <div className="slider-thumb" style={{ left: `${percent}%` }} />
      </div>
      <span className="slider-value">{value}{unit}</span>
      {onReset && isDifferent && (
        <button className="slider-reset-btn" onClick={onReset} type="button">Reset</button>
      )}
    </div>
  );
}

/* ── SliderGroup — wraps related sliders in a bordered subsection ────── */

interface SliderGroupProps {
  title?: string;
  children: ReactNode;
}

export function SliderGroup({ title, children }: SliderGroupProps) {
  return (
    <div className="slider-group">
      {title && <div className="slider-group-label">{title}</div>}
      {children}
    </div>
  );
}

/* ── ColorInput — color picker with swatch + hex input ──────────────── */

interface ColorInputProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
}

export function ColorInput({ label, value, onChange }: ColorInputProps) {
  return (
    <div className="color-row">
      {label && <label>{label}</label>}
      <div className="color-wrap">
        <input
          type="color"
          className="color-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
        />
        <input
          type="text"
          className="color-hex"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}
