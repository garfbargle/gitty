import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import type { CommitEntry } from "../types";

type ResetToCommitDialogProps = {
  open: boolean;
  /// The branch tip that will be moved back to the commit.
  branch: string;
  /// The commit HEAD will be reset to.
  commit: CommitEntry | null;
  /// Uncommitted work that a hard reset would throw away.
  dirtyCount?: number;
  loading?: boolean;
  onConfirm: (mode: "soft" | "hard") => void;
  onCancel: () => void;
};

export function ResetToCommitDialog({
  open,
  branch,
  commit,
  dirtyCount = 0,
  loading = false,
  onConfirm,
  onCancel,
}: ResetToCommitDialogProps) {
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

  if (!open || !commit) return null;

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        className="confirm-dialog reset-commit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-commit-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="confirm-dialog-header">
          <div className="confirm-dialog-icon warn">
            <RotateCcw size={18} />
          </div>
          <div>
            <h2 id="reset-commit-title">Reset to this commit?</h2>
            <p className="confirm-dialog-lead">
              Moves <strong>{branch}</strong> back to this commit.
            </p>
          </div>
        </header>

        <section className="confirm-dialog-body">
          <div className="reset-target">
            <code>{commit.shortHash}</code>
            <div className="reset-target-message">{commit.subject}</div>
          </div>

          <ul className="reset-mode-list">
            <li>
              <strong>Soft</strong> — keeps your staged and unstaged changes.
            </li>
            <li>
              <strong>Hard</strong> —{" "}
              {dirtyCount > 0
                ? `discards all uncommitted changes (${dirtyCount} affected).`
                : "discards all uncommitted changes."}
            </li>
          </ul>
        </section>

        <footer className="confirm-dialog-actions">
          <button type="button" className="ghost-btn" onClick={onCancel} disabled={loading}>
            Cancel
            <kbd>Esc</kbd>
          </button>
          <button
            type="button"
            className="action-btn warn"
            disabled={loading}
            onClick={() => onConfirm("soft")}
          >
            <RotateCcw size={15} />
            Soft reset
          </button>
          <button
            type="button"
            className="action-btn danger"
            disabled={loading}
            onClick={() => onConfirm("hard")}
          >
            <RotateCcw size={15} />
            Hard reset
          </button>
        </footer>
      </div>
    </div>
  );
}
