import { Download, FolderGit2, Loader2, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { RemoteEntry } from "../types";

const NVIDIA_MODELS_URL = "https://build.nvidia.com/models";

type SettingsDrawerProps = {
  open: boolean;
  remotes: RemoteEntry[];
  remoteName: string;
  remoteUrl: string;
  autoSummarizeEnabled: boolean;
  nvidiaApiKeyConfigured: boolean;
  nvidiaApiKeyPreview?: string | null;
  settingsNvidiaKey: string;
  nvidiaKeyTesting?: boolean;
  nvidiaKeyTestMessage?: string | null;
  nvidiaKeyTestError?: boolean;
  onClose: () => void;
  onRemoteNameChange: (value: string) => void;
  onRemoteUrlChange: (value: string) => void;
  onAutoSummarizeEnabledChange: (enabled: boolean) => void;
  onSettingsNvidiaKeyChange: (value: string) => void;
  onSaveNvidiaApiKey: () => void;
  onDeleteNvidiaApiKey: () => void;
  onTestNvidiaApiKey: () => void;
  onSaveRemote: () => void;
  onRemoveRemote: (name: string) => void;
  onFetch: () => void;
  onRemoveRepo: () => void;
  disabled?: boolean;
};

export function SettingsDrawer({
  open,
  remotes,
  remoteName,
  remoteUrl,
  autoSummarizeEnabled,
  nvidiaApiKeyConfigured,
  nvidiaApiKeyPreview,
  settingsNvidiaKey,
  nvidiaKeyTesting = false,
  nvidiaKeyTestMessage = null,
  nvidiaKeyTestError = false,
  onClose,
  onRemoteNameChange,
  onRemoteUrlChange,
  onAutoSummarizeEnabledChange,
  onSettingsNvidiaKeyChange,
  onSaveNvidiaApiKey,
  onDeleteNvidiaApiKey,
  onTestNvidiaApiKey,
  onSaveRemote,
  onRemoveRemote,
  onFetch,
  onRemoveRepo,
  disabled,
}: SettingsDrawerProps) {
  if (!open) {
    return null;
  }

  const unique = new Map<string, RemoteEntry>();
  remotes.forEach((remote) => {
    if (remote.kind === "fetch" || !unique.has(remote.name)) {
      unique.set(remote.name, remote);
    }
  });

  async function openNvidiaLink(event: React.MouseEvent) {
    event.preventDefault();
    await openUrl(NVIDIA_MODELS_URL);
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-drawer" onClick={(event) => event.stopPropagation()}>
        <header className="settings-header">
          <h2>Settings</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <section className="settings-section">
          <h3>
            <Sparkles size={14} />
            Auto Summarize
          </h3>
          <p className="muted settings-hint">
            Summarize staged changes when you focus the commit message. Get a free key from{" "}
            <a
              href={NVIDIA_MODELS_URL}
              className="change-summary-link"
              onClick={(event) => void openNvidiaLink(event)}
            >
              NVIDIA
            </a>{" "}
            (sign in, pick a model, accept terms, then generate a key).
          </p>

          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={autoSummarizeEnabled}
              onChange={(event) => onAutoSummarizeEnabledChange(event.currentTarget.checked)}
              disabled={disabled}
            />
            Enable AI auto summarize
          </label>

          {nvidiaApiKeyConfigured && nvidiaApiKeyPreview ? (
            <p className="settings-key-preview">
              Saved key: <code>{nvidiaApiKeyPreview}</code>
            </p>
          ) : null}

          <form
            className="remote-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSaveNvidiaApiKey();
            }}
          >
            <input
              type="password"
              value={settingsNvidiaKey}
              onChange={(event) => onSettingsNvidiaKeyChange(event.currentTarget.value)}
              placeholder={nvidiaApiKeyConfigured ? "Paste a new key to replace…" : "Paste NVIDIA API key (nvapi-…)"}
              aria-label="NVIDIA API key"
              autoComplete="off"
              disabled={disabled}
            />
            <div className="settings-actions">
              <button
                type="submit"
                className="action-btn"
                disabled={disabled || !settingsNvidiaKey.trim()}
              >
                Save key
              </button>
              <button
                type="button"
                className="action-btn"
                disabled={disabled || nvidiaKeyTesting || (!settingsNvidiaKey.trim() && !nvidiaApiKeyConfigured)}
                onClick={() => onTestNvidiaApiKey()}
              >
                {nvidiaKeyTesting ? <Loader2 size={14} className="spin" /> : null}
                Test key
              </button>
              {nvidiaApiKeyConfigured ? (
                <button
                  type="button"
                  className="action-btn danger"
                  disabled={disabled}
                  onClick={() => onDeleteNvidiaApiKey()}
                >
                  Delete key
                </button>
              ) : null}
            </div>
          </form>

          {nvidiaKeyTestMessage ? (
            <p className={`settings-test-result ${nvidiaKeyTestError ? "error" : "success"}`}>
              {nvidiaKeyTestMessage}
            </p>
          ) : null}
        </section>

        <section className="settings-section">
          <h3>Remotes</h3>
          <div className="remote-chips">
            {unique.size === 0 ? (
              <p className="muted">No remotes configured</p>
            ) : (
              Array.from(unique.values()).map((remote) => (
                <div className="remote-chip" key={remote.name}>
                  <div>
                    <strong>{remote.name}</strong>
                    <span>{remote.url}</span>
                  </div>
                  <button type="button" className="link-btn danger" onClick={() => onRemoveRemote(remote.name)}>
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
            />
            <input
              value={remoteUrl}
              onChange={(event) => onRemoteUrlChange(event.currentTarget.value)}
              placeholder="git@github.com:user/repo.git"
              aria-label="Remote URL"
            />
            <button type="submit" className="action-btn" disabled={disabled}>
              Save remote
            </button>
          </form>
          <button type="button" className="action-btn" disabled={disabled} onClick={onFetch}>
            <Download size={15} />
            Fetch all remotes
          </button>
        </section>

        <section className="settings-section danger-zone">
          <h3>Repository</h3>
          <button type="button" className="action-btn danger" disabled={disabled} onClick={onRemoveRepo}>
            Remove from Gitty
          </button>
        </section>
      </div>
    </div>
  );
}

type MainToolbarProps = {
  repoName: string;
  branch: string;
  search: string;
  loading?: boolean;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
};

export function MainToolbar({
  repoName,
  branch,
  search,
  loading,
  onSearchChange,
  onRefresh,
}: MainToolbarProps) {
  return (
    <header className="main-toolbar">
      <div className="toolbar-left">
        <FolderGit2 size={18} className="toolbar-repo-icon" />
        <h2>{repoName}</h2>
        <span className="branch-pill">{branch}</span>
      </div>
      <div className="toolbar-search">
        <Search size={15} />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.currentTarget.value)}
          placeholder="Search commits"
        />
      </div>
      <button
        type="button"
        className="icon-btn"
        title="Refresh"
        disabled={loading}
        onClick={onRefresh}
      >
        <RefreshCw size={16} className={loading ? "spin" : ""} />
      </button>
    </header>
  );
}
