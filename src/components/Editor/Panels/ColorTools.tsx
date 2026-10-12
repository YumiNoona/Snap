import { Check, RotateCcw } from "lucide-react";
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
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { parseCube } from "../../../lib/colorLut";
import type { CubeLut } from "../../../lib/colorGrade";
import CurveEditor from "./CurveEditor";
import { SelectRow } from "./PanelControls";

export default function ColorTools({
  value,
  onChange,
  disabled = false,
  luts = [],
  onLutsChange,
}: {
  value?: ColorGrade;
  onChange: (grade: ColorGrade) => void;
  disabled?: boolean;
  luts?: CubeLut[];
  onLutsChange?: (luts: CubeLut[], grade?: ColorGrade) => void;
}) {
  const [error, setError] = useState("");
  const grade = normalizeColorGrade(value);
  const update = (patch: Partial<ColorGrade>) =>
    onChange({ ...grade, ...patch });
  return (
    <fieldset className="color-tools" disabled={disabled}>
      <legend hidden>Color look</legend>
      <CheckRow
        label="Enable look"
        checked={grade.enabled}
        onChange={(enabled) => update({ enabled })}
      />
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
              style={{
                filter: colorGradeFilter({
                  ...DEFAULT_COLOR_GRADE,
                  look: look.id,
                }),
              }}
            >
              <i />
              <b />
              <em />
            </span>
            <strong>{look.name}</strong>
            <small>{look.description}</small>
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
      <div className="color-tone-controls">
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
      </div>
      {onLutsChange && (
        <details className="color-section" open>
          <summary>Custom LUT</summary>
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
          <small>1D and 3D LUTs are embedded in your project.</small>
        </details>
      )}
      <details className="color-section">
        <summary>RGB curves</summary>
        <CurveEditor
          value={grade.curves}
          onChange={(curves) => update({ curves, enabled: true })}
        />
      </details>
      <button
        type="button"
        className="ss-drawer-action-btn"
        onClick={() => onChange({ ...DEFAULT_COLOR_GRADE })}
      >
        <RotateCcw size={14} />
        Reset color
      </button>
    </fieldset>
  );
}
