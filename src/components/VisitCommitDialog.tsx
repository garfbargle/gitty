import { useEffect, useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import type { CommitEntry, FileChange } from "../types";
import { isStaged, isUntracked, isUnstaged } from "../lib/git";

export type VisitCommitDialogAction = "stash" | "keep" | "discard" | "cancel";

type VisitCommitDialogProps = {
  open: boolean;
  commit: CommitEntry | null;
  changes: FileChange[];
  loading?: boolean;
  onAction: (action: VisitCommitDialogAction) => void;
};

export function VisitCommitDialog({
  open,
  commit,
  changes,
  loading = false,
  onAction,
}: VisitCommitDialogProps) {
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

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onAction("cancel");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onAction]);

  if (!open || !commit) return null;

  return (
    <div className="confirm-overlay" onClick={() => onAction("cancel")}>
      <div
        className="confirm-dialog visit-commit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="visit-commit-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="confirm-dialog-header">
          <div className="confirm-dialog-icon danger">
            <AlertTriangle size={18} />
          </div>
          <div>
            <h2 id="visit-commit-title">Uncommitted changes</h2>
            <p className="confirm-dialog-lead">
              Visit <code>{commit.shortHash}</code> requires a clean working tree or an explicit
              choice about your local changes.
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
        </section>

        <footer className="confirm-dialog-actions visit-commit-actions">
          <button type="button" className="ghost-btn" onClick={() => onAction("cancel")} disabled={loading}>
            Cancel
            <kbd>Esc</kbd>
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => onAction("keep")}
            disabled={loading}
          >
            Keep my changes
          </button>
          <button
            type="button"
            className="action-btn danger confirm-dialog-primary"
            onClick={() => onAction("discard")}
            disabled={loading}
          >
            Discard & visit
          </button>
          <button
            type="button"
            className="action-btn confirm-dialog-primary"
            onClick={() => onAction("stash")}
            disabled={loading}
          >
            Stash & visit
          </button>
        </footer>
      </div>
    </div>
  );
}
