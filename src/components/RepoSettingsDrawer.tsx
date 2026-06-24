import { Download, FolderGit2, X } from "lucide-react";
import type { RemoteEntry } from "../types";

type RepoSettingsDrawerProps = {
  open: boolean;
  repoName: string;
  remotes: RemoteEntry[];
  remoteName: string;
  remoteUrl: string;
  editingRemote: string | null;
  onClose: () => void;
  onRemoteNameChange: (value: string) => void;
  onRemoteUrlChange: (value: string) => void;
  onEditRemote: (remote: RemoteEntry) => void;
  onClearRemoteEdit: () => void;
  onSaveRemote: () => void;
  onRemoveRemote: (name: string) => void;
  onFetch: () => void;
  onRemoveRepo: () => void;
  disabled?: boolean;
};

function uniqueRemotes(remotes: RemoteEntry[]) {
  const unique = new Map<string, RemoteEntry>();
  remotes.forEach((remote) => {
    if (remote.kind === "fetch" || !unique.has(remote.name)) {
      unique.set(remote.name, remote);
    }
  });
  return Array.from(unique.values());
}

export function RepoSettingsDrawer({
  open,
  repoName,
  remotes,
  remoteName,
  remoteUrl,
  editingRemote,
  onClose,
  onRemoteNameChange,
  onRemoteUrlChange,
  onEditRemote,
  onClearRemoteEdit,
  onSaveRemote,
  onRemoveRemote,
  onFetch,
  onRemoveRepo,
  disabled,
}: RepoSettingsDrawerProps) {
  if (!open) {
    return null;
  }

  const listed = uniqueRemotes(remotes);
  const isEditing = editingRemote !== null;
  const canSave = remoteName.trim().length > 0 && remoteUrl.trim().length > 0;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-drawer" onClick={(event) => event.stopPropagation()}>
        <header className="settings-header">
          <div className="settings-header-title">
            <FolderGit2 size={16} />
            <div>
              <h2>Repository Settings</h2>
              <p className="muted settings-repo-name">{repoName}</p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <section className="settings-section">
          <h3>Git Remotes</h3>
          <p className="muted settings-hint">
            Remotes are stored in this repository&apos;s git config — not shared across other repos in Gitty.
          </p>

          <div className="remote-chips">
            {listed.length === 0 ? (
              <p className="muted">No remotes configured</p>
            ) : (
              listed.map((remote) => (
                <div
                  className={`remote-chip ${editingRemote === remote.name ? "active" : ""}`}
                  key={remote.name}
                >
                  <button
                    type="button"
                    className="remote-chip-main"
                    disabled={disabled}
                    onClick={() => onEditRemote(remote)}
                    title="Edit remote URL"
                  >
                    <strong>{remote.name}</strong>
                    <span>{remote.url}</span>
                  </button>
                  <button
                    type="button"
                    className="link-btn danger"
                    disabled={disabled}
                    onClick={() => onRemoveRemote(remote.name)}
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>

          <form
            className="remote-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSaveRemote();
            }}
          >
            <input
              value={remoteName}
              onChange={(event) => onRemoteNameChange(event.currentTarget.value)}
              placeholder="origin"
              aria-label="Remote name"
              disabled={disabled || isEditing}
            />
            <input
              value={remoteUrl}
              onChange={(event) => onRemoteUrlChange(event.currentTarget.value)}
              placeholder="git@github.com:user/repo.git"
              aria-label="Remote URL"
              disabled={disabled}
            />
            <div className="settings-actions">
              <button type="submit" className="action-btn" disabled={disabled || !canSave}>
                {isEditing ? "Update remote" : "Add remote"}
              </button>
              {isEditing ? (
                <button
                  type="button"
                  className="action-btn"
                  disabled={disabled}
                  onClick={onClearRemoteEdit}
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </form>

          <button type="button" className="action-btn" disabled={disabled || listed.length === 0} onClick={onFetch}>
            <Download size={15} />
            Fetch all remotes
          </button>
        </section>

        <section className="settings-section danger-zone">
          <h3>Remove from Gitty</h3>
          <p className="muted settings-hint">
            Removes this repo from the sidebar. Your files and git history on disk are not affected.
          </p>
          <button type="button" className="action-btn danger" disabled={disabled} onClick={onRemoveRepo}>
            Remove from Gitty
          </button>
        </section>
      </div>
    </div>
  );
}
