import { ArrowLeft, Clapperboard } from "lucide-react";
import { SelectRow } from "./Panels/PanelControls";
import type { ClipWorkspace, EditorRoute } from "../../lib/clipWorkspace";
interface Props {
  workspace: ClipWorkspace;
  currentPath: string;
  disabled: boolean;
  onNavigate: (route: EditorRoute) => void;
}
export default function ClipWorkspaceBar({
  workspace,
  currentPath,
  disabled,
  onNavigate,
}: Props) {
  const inOriginal = currentPath === workspace.original.projectPath;
  const routes = [workspace.original, ...workspace.clips];
  return (
    <nav className="ss-clip-workspace" aria-label="Clip workspace">
      <button
        className="ss-clip-return"
        disabled={disabled || inOriginal}
        onClick={() => onNavigate(workspace.original)}
      >
        <ArrowLeft size={14} />
        Original timeline
      </button>
      <Clapperboard size={14} />
      <SelectRow
        label="Open timeline"
        value={currentPath}
        disabled={disabled}
        options={routes.map((r) => r.projectPath)}
        optionLabels={Object.fromEntries(
          routes.map((r) => [r.projectPath, r.label]),
        )}
        onChange={(path) => {
          const target = routes.find((r) => r.projectPath === path);
          if (target) onNavigate(target);
        }}
      />
      <span>
        {inOriginal ? "Original timeline" : "Clip project"} · Changes save
        before switching
      </span>
    </nav>
  );
}
