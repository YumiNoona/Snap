import { Check, RotateCcw, Upload, Trash2 } from "lucide-react";
import Slider from "../../shared/Slider";
import { CheckRow } from "./PanelControls";
import {
  COLOR_LOOKS,
  DEFAULT_COLOR_GRADE,
  colorGradeFilter,
  normalizeColorGrade,
  type ColorGrade,
} from "../../../lib/colorGrade";
import "./ColorTools.css";
import { useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { parseCube } from "../../../lib/colorLut";
import type { CubeLut } from "../../../lib/colorGrade";
import CurveEditor from "./CurveEditor";
import { SelectRow } from "./PanelControls";
import ColorSection from "./ColorSection";

export default function ColorTools({
  value,
  onChange,
  disabled = false,
  luts = [],
  onLutsChange,
  gradeControls,
}: {
  value?: ColorGrade;
  onChange: (grade: ColorGrade) => void;
  disabled?: boolean;
  luts?: CubeLut[];
  onLutsChange?: (luts: CubeLut[], grade?: ColorGrade) => void;
  gradeControls?: ReactNode;
}) {
  const [error, setError] = useState("");
  const grade = normalizeColorGrade(value);
  const update = (patch: Partial<ColorGrade>) =>
    onChange({ ...grade, ...patch });
  return (
    <div className="color-tools-stack">
    <fieldset className="color-tools" disabled={disabled}>
      <legend hidden>Color look</legend>
      <ColorSection title="Film looks">
      <div className="color-look-grid" aria-label="Film looks">
        {COLOR_LOOKS.map((look) => (
          <button
            type="button"
            key={look.id}
            aria-label={`${look.name} look`}
            aria-pressed={grade.look === look.id}
            onClick={() => update({ look: look.id, enabled: true })}
          >
            <span
              className="color-look-art"
              aria-hidden="true"
              style={{
                filter: colorGradeFilter({
                  ...DEFAULT_COLOR_GRADE,
                  look: look.id,
                }),
              }}
            >
              <span />
            </span>
            <strong>{look.name}</strong>
            {grade.look === look.id && (
              <Check size={13} className="color-look-check" />
            )}
          </button>
        ))}
      </div>
      <Slider
        label="Intensity"
        value={grade.intensity}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(intensity) => update({ intensity })}
      />
      </ColorSection>
      <ColorSection title="Adjustments">
        <Slider
          label="Exposure"
          value={grade.exposure}
          min={-2}
          max={2}
          step={0.05}
          unit=" EV"
          onChange={(exposure) => update({ exposure })}
        />
        <Slider
          label="Contrast"
          value={grade.contrast}
          min={-50}
          max={50}
          step={1}
          unit=""
          onChange={(contrast) => update({ contrast })}
        />
        <Slider
          label="Saturation"
          value={grade.saturation}
          min={0}
          max={200}
          step={1}
          unit="%"
          onChange={(saturation) => update({ saturation })}
        />
        <Slider
          label="Warmth"
          value={grade.warmth}
          min={-100}
          max={100}
          step={1}
          unit=""
          onChange={(warmth) => update({ warmth })}
        />
        <Slider
          label="Vignette"
          value={grade.vignette}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={(vignette) => update({ vignette })}
        />
      </ColorSection>
    </fieldset>
    {gradeControls}
    <fieldset className="color-tools" disabled={disabled}>
      <legend hidden>Color processing</legend>
      <CheckRow
        label="Enable look"
        checked={grade.enabled}
        onChange={(enabled) => update({ enabled })}
      />
      {onLutsChange && (
        <ColorSection title="Custom LUT">
          <SelectRow
            label="Table"
            value={grade.lutId ?? "none"}
            options={["none", ...luts.map((l) => l.id)]}
            optionLabels={{
              none: "No LUT",
              ...Object.fromEntries(luts.map((l) => [l.id, l.name])),
            }}
            onChange={(id) =>
              update({ lutId: id === "none" ? undefined : id, enabled: true })
            }
          />
          <div className="color-inline-actions">
            <button
              type="button"
              onClick={async () => {
                try {
                  setError("");
                  const path = await open({
                    title: "Import a .cube LUT",
                    multiple: false,
                    filters: [{ name: "Cube LUT", extensions: ["cube"] }],
                  });
                  if (typeof path !== "string") return;
                  const text = await invoke<string>("read_text_file", { path }),
                    lut = parseCube(
                      text,
                      path.split(/[\\/]/).pop() ?? "Custom LUT",
                    );
                  onLutsChange([...luts, lut], {
                    ...grade,
                    lutId: lut.id,
                    enabled: true,
                  });
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              <Upload size={14} aria-hidden="true" />
              Import .cube
            </button>
            <button
              type="button"
              disabled={!grade.lutId}
              onClick={() => {
                onLutsChange(
                  luts.filter((l) => l.id !== grade.lutId),
                  { ...grade, lutId: undefined },
                );
              }}
            >
              <Trash2 size={14} aria-hidden="true" />
              Remove LUT
            </button>
          </div>
          {grade.lutId && (
            <Slider
              label="LUT strength"
              value={grade.lutStrength ?? 100}
              min={0}
              max={100}
              step={1}
              unit="%"
              onChange={(lutStrength) => update({ lutStrength })}
            />
          )}
          {grade.lutId && !luts.some((l) => l.id === grade.lutId) && (
            <p role="alert">
              This LUT is missing. Import it again or select another.
            </p>
          )}
          {error && (
            <p className="color-error" role="alert">
              {error}
            </p>
          )}
        </ColorSection>
      )}
      <ColorSection title="RGB curves">
        <CurveEditor
          value={grade.curves}
          onChange={(curves) => update({ curves, enabled: true })}
        />
      </ColorSection>
      <button
        type="button"
        className="ss-drawer-action-btn"
        onClick={() => onChange({ ...DEFAULT_COLOR_GRADE })}
      >
        <RotateCcw size={14} />
        Reset color
      </button>
    </fieldset>
    </div>
  );
}
