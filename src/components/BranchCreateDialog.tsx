import { useEffect, useId, useRef, useState } from "react";
import { GitBranch } from "lucide-react";
import type { FileChange } from "../types";
import { suggestBranchName } from "../lib/branches";
import { SettingsModal } from "./SettingsModal";

type BranchCreateDialogProps = {
  open: boolean;
  /// The point the new branch forks from — usually the trunk you're rescuing
  /// changes off of.
  fromBranch: string;
  /// Uncommitted changes that will travel onto the new branch.
  changes: FileChange[];
  loading?: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
};

export function BranchCreateDialog({
  open,
  fromBranch,
  changes,
  loading = false,
  onConfirm,
  onCancel,
}: BranchCreateDialogProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const suggestion = suggestBranchName(changes);
  const changeCount = changes.length;

  useEffect(() => {
    if (!open) return;
    setName("");
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed || loading) return;
    onConfirm(trimmed);
  }

  return (
    <SettingsModal
      open={open}
      title="Start a branch"
      subtitle={
        changeCount > 0
          ? `From ${fromBranch} · brings your ${changeCount} change${changeCount === 1 ? "" : "s"} along`
          : `From ${fromBranch}`
      }
      onClose={onCancel}
      footer={
        <div className="settings-footer-actions">
          <button type="button" className="ghost-btn" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="commit-primary"
            onClick={submit}
            disabled={loading || !name.trim()}
          >
            <GitBranch size={14} />
            Create branch
            <kbd>↵</kbd>
          </button>
        </div>
      }
    >
      <label className="field-label" htmlFor={inputId}>
        Branch name
      </label>
      <input
        id={inputId}
        ref={inputRef}
        className="settings-input"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={suggestion ?? "my-feature"}
        disabled={loading}
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="off"
      />
      {suggestion && !name ? (
        <button type="button" className="branch-suggestion" onClick={() => setName(suggestion)}>
          Use <strong>{suggestion}</strong>
        </button>
      ) : null}
    </SettingsModal>
  );
}
