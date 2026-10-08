import { useState, useEffect, useRef } from "react";
import { ChevronDown, Check } from "lucide-react";
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="ss-section"><h4 className="ss-section-heading">{title}</h4><div className="ss-section-body">{children}</div></section>;
}

export function SelectRow({ label, value, options, optionLabels, onChange }: { label: string; value: string; options: string[]; optionLabels?: Record<string, string>; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const optionLabel = (option: string) => optionLabels?.[option] ?? option.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="field-row select-row custom-select-row" ref={rootRef}>
      <span className="field-label">{label}</span>
      <div className="custom-select">
        <button type="button" className={`custom-select-trigger ${open ? "open" : ""}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          <span>{optionLabel(value)}</span><ChevronDown size={14} />
        </button>
        {open && <div className="custom-select-menu" role="listbox" aria-label={label}>
          {options.map((option) => <button type="button" role="option" aria-selected={option === value} key={option} onClick={() => { onChange(option); setOpen(false); }}><span>{optionLabel(option)}</span>{option === value && <Check size={14} />}</button>)}
        </div>}
      </div>
    </div>
  );
}

export function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className="field-row check-row" onClick={() => onChange(!checked)} aria-pressed={checked}>
      <span className="field-label">{label}</span>
      <span className={`pro-switch ${checked ? "checked" : ""}`} aria-hidden="true"><span /></span>
    </button>
  );
}

