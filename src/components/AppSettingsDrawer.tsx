import { Loader2, Sparkles, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

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
  if (!open) {
    return null;
  }

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
      </div>
    </div>
  );
}
