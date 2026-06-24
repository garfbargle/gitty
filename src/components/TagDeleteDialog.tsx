import type { CommitEntry } from "../types";
import { SettingsModal } from "./SettingsModal";

type TagDeleteDialogProps = {
  open: boolean;
  commit: CommitEntry | null;
  tagName: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function TagDeleteDialog({
  open,
  commit,
  tagName,
  loading = false,
  onConfirm,
  onCancel,
}: TagDeleteDialogProps) {
  return (
    <SettingsModal
      open={open && !!commit && !!tagName}
      title={`Delete tag "${tagName}"?`}
      subtitle={commit ? `${commit.shortHash} · ${commit.subject}` : undefined}
      onClose={onCancel}
      footer={
        <div className="settings-footer-actions">
          <button type="button" className="ghost-btn" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="action-btn danger"
            onClick={onConfirm}
            disabled={loading}
          >
            Delete tag
          </button>
        </div>
      }
    >
      <p className="settings-modal-subtitle">
        This removes the tag locally. It will not delete the tag on the remote.
      </p>
    </SettingsModal>
  );
}
