import { ExternalLink, Loader2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SettingsModal } from "./SettingsModal";

const NVIDIA_MODELS_URL = "https://build.nvidia.com/models";

type AppSettingsDrawerProps = {
  open: boolean;
  autoSummarizeEnabled: boolean;
  nvidiaApiKeyConfigured: boolean;
  nvidiaApiKeyPreview?: string | null;
  settingsNvidiaKey: string;
  nvidiaKeyTesting?: boolean;
  nvidiaKeyTestMessage?: string | null;
  nvidiaKeyTestError?: boolean;
  backupRemoteName: string;
  backupUrlTemplate: string;
  backupSaving?: boolean;
  backupSaveMessage?: string | null;
  backupSaveError?: boolean;
  onClose: () => void;
  onAutoSummarizeEnabledChange: (enabled: boolean) => void;
  onSettingsNvidiaKeyChange: (value: string) => void;
  onSaveNvidiaApiKey: () => void;
  onDeleteNvidiaApiKey: () => void;
  onTestNvidiaApiKey: () => void;
  onBackupRemoteNameChange: (value: string) => void;
  onBackupUrlTemplateChange: (value: string) => void;
  onSaveBackupProfile: () => void;
  disabled?: boolean;
};

export function AppSettingsDrawer({
  open,
  autoSummarizeEnabled,
  nvidiaApiKeyConfigured,
  nvidiaApiKeyPreview,
  settingsNvidiaKey,
  nvidiaKeyTesting = false,
  nvidiaKeyTestMessage = null,
  nvidiaKeyTestError = false,
  backupRemoteName,
  backupUrlTemplate,
  backupSaving = false,
  backupSaveMessage = null,
  backupSaveError = false,
  onClose,
  onAutoSummarizeEnabledChange,
  onSettingsNvidiaKeyChange,
  onSaveNvidiaApiKey,
  onDeleteNvidiaApiKey,
  onTestNvidiaApiKey,
  onBackupRemoteNameChange,
  onBackupUrlTemplateChange,
  onSaveBackupProfile,
  disabled,
}: AppSettingsDrawerProps) {
  const hasDraftKey = settingsNvidiaKey.trim().length > 0;

  async function openNvidiaLink(event: React.MouseEvent) {
    event.preventDefault();
    await openUrl(NVIDIA_MODELS_URL);
  }

  return (
    <SettingsModal open={open} title="Settings" onClose={onClose}>
      <label className="settings-row">
        <span className="settings-row-copy">
          <strong>Auto summarize</strong>
          <span>Suggest commit messages from your uncommitted changes</span>
        </span>
        <input
          type="checkbox"
          className="settings-switch"
          checked={autoSummarizeEnabled}
          onChange={(event) => onAutoSummarizeEnabledChange(event.currentTarget.checked)}
          disabled={disabled}
        />
      </label>

      <div className="settings-field">
        <div className="settings-field-head">
          <label htmlFor="nvidia-api-key">NVIDIA API key</label>
          <a
            href={NVIDIA_MODELS_URL}
            className="settings-inline-link"
            onClick={(event) => void openNvidiaLink(event)}
          >
            Get a key
            <ExternalLink size={12} />
          </a>
        </div>
        <input
          id="nvidia-api-key"
          type="password"
          className="settings-input"
          value={settingsNvidiaKey}
          onChange={(event) => onSettingsNvidiaKeyChange(event.currentTarget.value)}
          placeholder={nvidiaApiKeyConfigured ? "Paste a new key to replace…" : "nvapi-…"}
          autoComplete="off"
          disabled={disabled}
        />
        {nvidiaApiKeyConfigured && nvidiaApiKeyPreview && !hasDraftKey ? (
          <p className="settings-field-note success">Saved · {nvidiaApiKeyPreview}</p>
        ) : (
          <p className="settings-field-note">Required for auto summarize</p>
        )}
        {nvidiaKeyTestMessage ? (
          <p className={`settings-field-note ${nvidiaKeyTestError ? "error" : "success"}`}>
            {nvidiaKeyTestMessage}
          </p>
        ) : null}
        <div className="settings-inline-actions">
          <button
            type="button"
            className="settings-btn primary"
            disabled={disabled || !hasDraftKey}
            onClick={() => onSaveNvidiaApiKey()}
          >
            Save key
          </button>
          <button
            type="button"
            className="settings-btn"
            disabled={disabled || nvidiaKeyTesting || (!hasDraftKey && !nvidiaApiKeyConfigured)}
            onClick={() => onTestNvidiaApiKey()}
          >
            {nvidiaKeyTesting ? <Loader2 size={14} className="spin" /> : null}
            Test
          </button>
          {nvidiaApiKeyConfigured ? (
            <button
              type="button"
              className="settings-btn danger-text"
              disabled={disabled}
              onClick={() => onDeleteNvidiaApiKey()}
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>

      <div className="settings-field">
        <div className="settings-field-head">
          <label>Backup default</label>
        </div>
        <p className="settings-field-note">
          Save a default remote name and URL pattern. Repositories without that backup offer setup
          when you open their Repository settings.
        </p>
        <div className="settings-inline-actions backup-template-fields">
          <input
            className="settings-input settings-input-compact"
            value={backupRemoteName}
            onChange={(event) => onBackupRemoteNameChange(event.currentTarget.value)}
            placeholder="backup"
            aria-label="Backup remote name"
            disabled={disabled || backupSaving}
          />
          <input
            className="settings-input"
            value={backupUrlTemplate}
            onChange={(event) => onBackupUrlTemplateChange(event.currentTarget.value)}
            placeholder="https://git.example.com/alice/{repo}.git"
            aria-label="Backup URL template"
            disabled={disabled || backupSaving}
          />
        </div>
        <p className="settings-field-note">
          Include <code>{"{repo}"}</code>; it becomes each local repository name. The destination
          must already exist unless your host supports create-on-push. Gitty never stores credentials.
        </p>
        <button
          type="button"
          className="settings-btn primary"
          disabled={disabled || backupSaving || !backupRemoteName.trim() || !backupUrlTemplate.trim()}
          onClick={onSaveBackupProfile}
        >
          {backupSaving ? <Loader2 size={14} className="spin" /> : null}
          Save backup default
        </button>
        {backupSaveMessage ? (
          <p className={`settings-field-note backup-result ${backupSaveError ? "error" : "success"}`}>
            {backupSaveMessage}
          </p>
        ) : null}
      </div>
    </SettingsModal>
  );
}
