import { useState } from "react";
import { Copy, Trash2, ChevronUp, ChevronDown, Plus, SlidersHorizontal } from "lucide-react";
import ColorTools from "./ColorTools";
import Slider from "../../shared/Slider";
import { CheckRow, SelectRow } from "./PanelControls";
import {
  DEFAULT_COLOR_GRADE,
  type ColorComparison,
  type ColorGrade,
} from "../../../lib/colorGrade";
import type { EditorConfig } from "../../../lib/types";
import ColorSection from "./ColorSection";
export default function ColorStudio({
  config,
  onChange,
  clipId,
  position,
  length,
  comparison,
  onComparison,
}: {
  config: EditorConfig;
  onChange: (c: EditorConfig) => void;
  clipId?: string;
  position: number;
  length: number;
  comparison: ColorComparison;
  onComparison: (c: ColorComparison) => void;
}) {
  const [scope, setScope] = useState("project"),
    [adjustmentId, setAdjustmentId] = useState("");
  const clip = config.videoClips?.find((c) => c.id === clipId),
    adjustments = config.adjustmentLayers ?? [],
    selected = adjustments.find((a) => a.id === adjustmentId);
  const disabled =
    config.lockedTracks?.includes(
      scope === "adjustment" ? "adjustments" : "video",
    ) ||
    (scope === "clip" && !clip) ||
    (scope === "adjustment" && !selected);
  const grade =
    scope === "clip"
      ? (clip?.colorGrade ?? config.colorGrade)
      : scope === "adjustment"
        ? selected?.grade
        : config.colorGrade;
  const updateGrade = (colorGrade: ColorGrade, colorLuts = config.colorLuts) =>
    onChange(
      scope === "clip"
        ? {
            ...config,
            colorLuts,
            videoClips:
              config.videoClips?.map((c) =>
                c.id === clipId ? { ...c, colorGrade } : c,
              ) ?? null,
          }
        : scope === "adjustment"
          ? {
              ...config,
              colorLuts,
              adjustmentLayers: adjustments.map((a) =>
                a.id === adjustmentId ? { ...a, grade: colorGrade } : a,
              ),
            }
          : { ...config, colorLuts, colorGrade },
    );
  const patch = (id: string, change: Partial<(typeof adjustments)[number]>) =>
    onChange({
      ...config,
      adjustmentLayers: adjustments.map((a) =>
        a.id === id ? { ...a, ...change } : a,
      ),
    });
  const gradeControls = (
    <div className="color-grade-controls">
      <SelectRow
        label="Apply to"
        value={scope}
        options={["project", "clip", "adjustment"]}
        optionLabels={{
          project: "Whole project",
          clip: "Selected clip",
          adjustment: "Adjustment layer",
        }}
        onChange={setScope}
      />
      {scope === "clip" && (
        <>
          {!clip && <p className="color-empty">Select a clip in the timeline.</p>}
          <button
            className="ss-drawer-action-btn"
            disabled={!clip?.colorGrade || disabled}
            onClick={() =>
              onChange({
                ...config,
                videoClips:
                  config.videoClips?.map((c) =>
                    c.id === clipId ? { ...c, colorGrade: undefined } : c,
                  ) ?? null,
              })
            }
          >
            Use project grade
          </button>
        </>
      )}
      <CheckRow
        label="Compare original"
        checked={comparison.enabled}
        onChange={(enabled) => onComparison({ ...comparison, enabled })}
      />
      {comparison.enabled && (
        <>
          <Slider
            label="Wipe position"
            value={comparison.split * 100}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => onComparison({ ...comparison, split: v / 100 })}
          />
          <CheckRow
            label="Original on right"
            checked={comparison.reverse}
            onChange={(reverse) => onComparison({ ...comparison, reverse })}
          />
        </>
      )}
      <ColorSection
        title="Adjustment layers"
      >
        <button
          className="ss-drawer-action-btn"
          disabled={config.lockedTracks?.includes("adjustments")}
          onClick={() => {
            const id = crypto.randomUUID();
            onChange({
              ...config,
              adjustmentLayers: [
                ...adjustments,
                {
                  id,
                  name: `Adjustment ${adjustments.length + 1}`,
                  start: position,
                  end: Math.max(position + 0.1, length),
                  enabled: true,
                  opacity: 1,
                  grade: { ...DEFAULT_COLOR_GRADE },
                },
              ],
            });
            setAdjustmentId(id);
            setScope("adjustment");
          }}
        >
          <Plus size={15} aria-hidden="true" />
          Add adjustment layer
        </button>
        {adjustments.map((a, i) => (
          <div className={`adjustment-item${scope === "adjustment" && a.id === adjustmentId ? " selected" : ""}`} key={a.id}>
            <header>
              <input
                aria-label="Adjustment layer name"
                disabled={config.lockedTracks?.includes("adjustments")}
                value={a.name}
                onChange={(e) => patch(a.id, { name: e.target.value })}
              />
              <button
                type="button"
                aria-label="Edit adjustment grade"
                className="color-icon-button"
                onClick={() => {
                  setAdjustmentId(a.id);
                  setScope("adjustment");
                }}
              >
                <SlidersHorizontal size={15} aria-hidden="true" />
              </button>
            </header>
            <fieldset
              disabled={config.lockedTracks?.includes("adjustments")}
              className="color-tools"
            >
              <CheckRow
                label="Enabled"
                checked={a.enabled}
                onChange={(enabled) => patch(a.id, { enabled })}
              />
              <div className="color-point-inputs">
                <label>
                  In (s)
                  <input
                    aria-label={`${a.name} in`}
                    type="number"
                    min="0"
                    max={a.end - 0.01}
                    step=".01"
                    value={a.start}
                    onChange={(e) =>
                      patch(a.id, {
                        start: Math.max(
                          0,
                          Math.min(a.end - 0.01, Number(e.target.value)),
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Out (s)
                  <input
                    aria-label={`${a.name} out`}
                    type="number"
                    min={a.start + 0.01}
                    step=".01"
                    value={a.end}
                    onChange={(e) =>
                      patch(a.id, {
                        end: Math.max(a.start + 0.01, Number(e.target.value)),
                      })
                    }
                  />
                </label>
              </div>
              <Slider
                label="Opacity"
                value={a.opacity * 100}
                min={0}
                max={100}
                step={1}
                unit="%"
                onChange={(v) => patch(a.id, { opacity: v / 100 })}
              />
              <div className="adjustment-mask-select">
                <SelectRow
                  label="Mask"
                  value={a.mask?.shape ?? "none"}
                  options={["none", "rectangle", "ellipse"]}
                  optionLabels={{
                    none: "Full frame",
                    rectangle: "Rectangle",
                    ellipse: "Ellipse",
                  }}
                  onChange={(shape) =>
                    patch(a.id, {
                      mask:
                        shape === "none"
                          ? undefined
                          : {
                              x: 0.25,
                              y: 0.25,
                              w: 0.5,
                              h: 0.5,
                              feather: 0.02,
                              inverted: false,
                              ...a.mask,
                              shape: shape as "rectangle" | "ellipse",
                            },
                    })
                  }
                />
              </div>
              {a.mask && (
                <ColorSection title="Mask bounds & feather">
                  {(["x", "y", "w", "h", "feather"] as const).map((field) => (
                    <Slider
                      key={field}
                      label={
                        {
                          x: "Left",
                          y: "Top",
                          w: "Width",
                          h: "Height",
                          feather: "Feather",
                        }[field]
                      }
                      value={a.mask![field] * 100}
                      min={field === "w" || field === "h" ? 1 : 0}
                      max={field === "feather" ? 20 : 100}
                      step={1}
                      unit="%"
                      onChange={(value) =>
                        patch(a.id, {
                          mask: { ...a.mask!, [field]: value / 100 },
                        })
                      }
                    />
                  ))}
                  <CheckRow
                    label="Invert mask"
                    checked={a.mask.inverted}
                    onChange={(inverted) =>
                      patch(a.id, { mask: { ...a.mask!, inverted } })
                    }
                  />
                </ColorSection>
              )}
              <div className="color-inline-actions">
                <button
                  aria-label="Duplicate adjustment"
                  onClick={() =>
                    onChange({
                      ...config,
                      adjustmentLayers: [
                        ...adjustments,
                        {
                          ...structuredClone(a),
                          id: crypto.randomUUID(),
                          name: `${a.name} copy`,
                        },
                      ],
                    })
                  }
                >
                  <Copy size={14} />
                </button>
                <button
                  aria-label="Move adjustment down"
                  disabled={i === 0}
                  onClick={() => {
                    const next = [...adjustments];
                    [next[i], next[i - 1]] = [next[i - 1], next[i]];
                    onChange({ ...config, adjustmentLayers: next });
                  }}
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  aria-label="Move adjustment up"
                  disabled={i === adjustments.length - 1}
                  onClick={() => {
                    const next = [...adjustments];
                    [next[i], next[i + 1]] = [next[i + 1], next[i]];
                    onChange({ ...config, adjustmentLayers: next });
                  }}
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  aria-label="Delete adjustment"
                  onClick={() => {
                    onChange({
                      ...config,
                      adjustmentLayers: adjustments.filter(
                        (l) => l.id !== a.id,
                      ),
                    });
                    if (a.id === adjustmentId) setAdjustmentId("");
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </fieldset>
          </div>
        ))}
      </ColorSection>
    </div>
  );
  return (
    <div className="color-studio ss-drawer-content">
      <ColorTools
        gradeControls={gradeControls}
        value={grade}
        disabled={disabled}
        onChange={updateGrade}
        luts={config.colorLuts}
        onLutsChange={(colorLuts, nextGrade) =>
          updateGrade(nextGrade ?? grade ?? DEFAULT_COLOR_GRADE, colorLuts)
        }
      />
    </div>
  );
}
