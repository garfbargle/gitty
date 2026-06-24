import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { FileChange } from "../types";
import { isStaged, isUntracked, isUnstaged } from "../lib/git";

type ResetAllConfirmDialogProps = {
  open: boolean;
  repoName: string;
  changes: FileChange[];
  loading?: boolean;
  onConfirm: (includeUntracked: boolean) => void;
  onCancel: () => void;
};

export function ResetAllConfirmDialog({
  open,
  repoName,
  changes,
  loading = false,
  onConfirm,
  onCancel,
}: ResetAllConfirmDialogProps) {
  const confirmInputId = useId();
  const confirmInputRef = useRef<HTMLInputElement>(null);
  const confirmPhrase = repoName.trim() || "reset";

  const stagedCount = changes.filter(isStaged).length;
  const unstagedCount = changes.filter(isUnstaged).length;
  const untrackedCount = changes.filter(isUntracked).length;
  const previewPaths = useMemo(
    () => [...new Set(changes.map((change) => change.path))].slice(0, 6),
    [changes],
  );
  const uniquePathCount = useMemo(
    () => new Set(changes.map((change) => change.path)).size,
    [changes],
  );
  const hiddenPathCount = Math.max(0, uniquePathCount - previewPaths.length);

  const [confirmText, setConfirmText] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(untrackedCount > 0);

  const confirmed = confirmText === confirmPhrase;

  useEffect(() => {
    if (!open) return;
    setConfirmText("");
    setIncludeUntracked(untrackedCount > 0);
    const timer = window.setTimeout(() => confirmInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, untrackedCount]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        className="confirm-dialog reset-all-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-all-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="confirm-dialog-header">
          <div className="confirm-dialog-icon danger">
            <AlertTriangle size={18} />
          </div>
          <div>
            <h2 id="reset-all-title">Reset all changes?</h2>
            <p className="confirm-dialog-lead">
              This permanently discards uncommitted work in <strong>{repoName}</strong>.
            </p>
          </div>
        </header>

        <section className="confirm-dialog-body">
          <ul className="reset-all-summary">
            {stagedCount > 0 ? (
              <li>
                <strong>{stagedCount}</strong> staged {stagedCount === 1 ? "file" : "files"}
              </li>
            ) : null}
            {unstagedCount > 0 ? (
              <li>
                <strong>{unstagedCount}</strong> unstaged{" "}
                {unstagedCount === 1 ? "change" : "changes"}
              </li>
            ) : null}
            {untrackedCount > 0 ? (
              <li>
                <strong>{untrackedCount}</strong> untracked {untrackedCount === 1 ? "file" : "files"}
              </li>
            ) : null}
          </ul>

          {previewPaths.length > 0 ? (
            <div className="reset-all-preview">
              {previewPaths.map((path) => (
                <code key={path}>{path}</code>
              ))}
              {hiddenPathCount > 0 ? (
                <span className="reset-all-preview-more">+{hiddenPathCount} more</span>
              ) : null}
            </div>
          ) : null}

          {untrackedCount > 0 ? (
            <label className="reset-all-option">
              <input
                type="checkbox"
                checked={includeUntracked}
                onChange={(event) => setIncludeUntracked(event.currentTarget.checked)}
                disabled={loading}
              />
              Also remove {untrackedCount} untracked {untrackedCount === 1 ? "file" : "files"}
            </label>
          ) : null}

          <label className="reset-all-confirm-field" htmlFor={confirmInputId}>
            Type <code>{confirmPhrase}</code> to confirm
            <input
              id={confirmInputId}
              ref={confirmInputRef}
              type="text"
              value={confirmText}
              onChange={(event) => setConfirmText(event.currentTarget.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={loading}
              placeholder={confirmPhrase}
            />
          </label>
        </section>

        <footer className="confirm-dialog-actions">
          <button type="button" className="ghost-btn" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="action-btn danger"
            disabled={!confirmed || loading}
            onClick={() => onConfirm(includeUntracked)}
          >
            Reset all changes
          </button>
        </footer>
      </div>
    </div>
  );
}
