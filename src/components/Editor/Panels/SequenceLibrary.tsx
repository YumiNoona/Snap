import { Copy, Trash2, Layers3, Plus } from "lucide-react";
import { beginMediaDrag } from "../../../lib/mediaDrag";
import { retainedClips, sequenceDuration } from "../../../lib/videoEditing";
import type { NestedSequence } from "../../../lib/types";
export default function SequenceLibrary({
  sequences,
  scopeId,
  referencedIds = [],
  duration,
  onInsert,
  onEdit,
  onChange,
}: {
  sequences: NestedSequence[];
  scopeId?: string;
  referencedIds?: string[];
  duration: number;
  onInsert: (id: string) => void;
  onEdit: (id: string) => void;
  onChange: (sequences: NestedSequence[]) => void;
}) {
  return (
    <section className="sequence-library">
      <h3>Sequences</h3>
      {!sequences.length && (
        <p>
          Select adjacent footage clips, then choose Nest in their context menu.
        </p>
      )}
      {sequences.map((s) => {
        const length = sequenceDuration(
            retainedClips(
              s.editor.videoClips,
              s.editor.trimStart,
              s.editor.trimEnd || duration,
            ),
          ),
          used =
            referencedIds.includes(s.id) ||
            sequences.some((d) =>
              d.editor.videoClips?.some((c) => c.sequenceId === s.id),
            );
        return (
          <article
            className="sequence-library-card"
            key={s.id}
            onDoubleClick={() => onEdit(s.id)}
            onPointerDown={(e) =>
              beginMediaDrag(e, [
                {
                  path: `snap-sequence:${s.id}`,
                  kind: "sequence",
                  name: s.name,
                  duration: length,
                },
              ])
            }
          >
            <Layers3 size={24} />
            <input
              aria-label="Sequence name"
              value={s.name}
              onChange={(e) =>
                onChange(
                  sequences.map((d) =>
                    d.id === s.id ? { ...d, name: e.target.value } : d,
                  ),
                )
              }
            />
            <small>
              {length.toFixed(2)}s · {s.editor.videoClips?.length ?? 1} clips
            </small>
            <div>
              <button
                aria-label={`Insert ${s.name}`}
                disabled={scopeId === s.id}
                onClick={() => onInsert(s.id)}
              >
                <Plus size={14} />
              </button>
              <button onClick={() => onEdit(s.id)}>Edit</button>
              <button
                aria-label={`Duplicate ${s.name}`}
                onClick={() =>
                  onChange([
                    ...sequences,
                    {
                      ...structuredClone(s),
                      id: crypto.randomUUID(),
                      name: `${s.name} copy`,
                    },
                  ])
                }
              >
                <Copy size={14} />
              </button>
              <button
                aria-label={`Delete ${s.name}`}
                disabled={used || scopeId === s.id}
                onClick={() => onChange(sequences.filter((d) => d.id !== s.id))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
