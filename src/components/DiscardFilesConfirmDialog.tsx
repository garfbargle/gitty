import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import type { FileChange } from "../types";
import { isUntracked } from "../lib/git";

type DiscardFilesConfirmDialogProps = {
  open: boolean;
  paths: string[];
  changes: FileChange[];
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function DiscardFilesConfirmDialog({
  open,
  paths,
  changes,
  loading = false,
  onConfirm,
  onCancel,
}: DiscardFilesConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const uniquePaths = useMemo(() => [...new Set(paths)], [paths]);
  const previewPaths = uniquePaths.slice(0, 8);
  const hiddenPathCount = Math.max(0, uniquePaths.length - previewPaths.length);
  const untrackedCount = useMemo(
    () =>
      uniquePaths.filter((path) => {
        const change = changes.find((item) => item.path === path);
        return change ? isUntracked(change) : false;
      }).length,
    [changes, uniquePaths],
  );
  const fileLabel = uniquePaths.length === 1 ? "file" : "files";

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => confirmButtonRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key === "Enter" && !loading) {
        event.preventDefault();
        onConfirm();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, loading, onCancel, onConfirm]);

  if (!open || uniquePaths.length === 0) return null;

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        className="confirm-dialog discard-files-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discard-files-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="confirm-dialog-header">
          <div className="confirm-dialog-icon danger">
            <AlertTriangle size={18} />
          </div>
          <div>
            <h2 id="discard-files-title">
              Discard {uniquePaths.length} {fileLabel}?
            </h2>
            <p className="confirm-dialog-lead">
              This permanently removes uncommitted changes for the selected {fileLabel}.
            </p>
          </div>
        </header>

        <section className="confirm-dialog-body">
          {untrackedCount > 0 ? (
            <p className="discard-files-note">
              {untrackedCount} untracked {untrackedCount === 1 ? "file will be deleted" : "files will be deleted"}.
            </p>
          ) : null}

          <div className="reset-all-preview">
            {previewPaths.map((path) => (
              <code key={path}>{path}</code>
            ))}
            {hiddenPathCount > 0 ? (
              <span className="reset-all-preview-more">+{hiddenPathCount} more</span>
            ) : null}
          </div>
        </section>

        <footer className="confirm-dialog-actions">
          <button type="button" className="ghost-btn" onClick={onCancel} disabled={loading}>
            Cancel
            <kbd>Esc</kbd>
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            className="action-btn danger confirm-dialog-primary"
            disabled={loading}
            onClick={onConfirm}
          >
            Discard changes
            <kbd>↵</kbd>
          </button>
        </footer>
      </div>
    </div>
  );
}
