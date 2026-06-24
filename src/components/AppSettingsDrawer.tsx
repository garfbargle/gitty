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
  onClose: () => void;
  onAutoSummarizeEnabledChange: (enabled: boolean) => void;
  onSettingsNvidiaKeyChange: (value: string) => void;
  onSaveNvidiaApiKey: () => void;
  onDeleteNvidiaApiKey: () => void;
  onTestNvidiaApiKey: () => void;
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
  onClose,
  onAutoSummarizeEnabledChange,
  onSettingsNvidiaKeyChange,
  onSaveNvidiaApiKey,
  onDeleteNvidiaApiKey,
  onTestNvidiaApiKey,
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
          <span>Suggest commit messages from staged changes</span>
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
    </SettingsModal>
  );
}
