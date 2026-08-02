import { FolderMinus, Loader2 } from "lucide-react";
import type { WorktreeEntry } from "../types";
import { SHORTCUT } from "../lib/shortcuts";
import { SettingsModal } from "./SettingsModal";

type RemoveWorktreeConfirmDialogProps = {
  worktree: WorktreeEntry | null;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/// Removing a checkout deletes a folder from disk, so it gets the same
/// clearly-worded ask as discarding changes or resetting: the plan's rule is
/// that nothing moves the user's files without one, and a trash icon beside a
/// list row is not one.
export function RemoveWorktreeConfirmDialog({
  worktree,
  loading,
  onCancel,
  onConfirm,
}: RemoveWorktreeConfirmDialogProps) {
  if (!worktree) return null;

  return (
    <SettingsModal
      open
      title="Remove this folder?"
      onClose={onCancel}
      footer={
        <div className="confirm-dialog-actions">
          <button type="button" className="settings-btn" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="action-btn danger confirm-dialog-primary"
            disabled={loading}
            onClick={onConfirm}
          >
            {loading ? <Loader2 size={13} className="spin" /> : <FolderMinus size={13} />}
            Remove folder
            <kbd>{SHORTCUT.confirm}</kbd>
          </button>
        </div>
      }
    >
      <p className="confirm-dialog-lede">
        This deletes the folder from your disk. The branch itself is not
        deleted, and its commits are untouched.
      </p>

      <div className="worktree-remove-target">
        <span className="worktree-remove-branch">{worktree.branch ?? "detached"}</span>
        <code title={worktree.path}>{worktree.path}</code>
      </div>

      <p className="confirm-dialog-note">
        Anything in that folder which is not committed will be lost. Git refuses
        to remove a folder with uncommitted changes, so if it has any, this will
        stop and tell you.
      </p>
    </SettingsModal>
  );
}
