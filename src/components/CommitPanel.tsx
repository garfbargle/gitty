import { useEffect, useState, type RefObject } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  GitCommitHorizontal,
  Link2,
  Loader2,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import type { BranchEntry, CommitEntry } from "../types";

const NVIDIA_MODELS_URL = "https://build.nvidia.com/models";

type CommitPanelProps = {
  message: string;
  messageInputRef: RefObject<HTMLTextAreaElement | null>;
  branch: string;
  branches: BranchEntry[];
  amend: boolean;
  resetMode: "soft" | "hard";
  selectedCommit?: CommitEntry | null;
  stagedCount: number;
  unstagedCount: number;
  changeCount: number;
  showCommitSection?: boolean;
  showResetSection?: boolean;
  showSetupRemote?: boolean;
  nvidiaApiKey?: string;
  nvidiaApiKeyConfigured?: boolean;
  changeSummary?: string | null;
  changeSummaryLoading?: boolean;
  changeSummaryError?: string | null;
  changeSummaryVisible?: boolean;
  onMessageChange: (value: string) => void;
  onMessageFocus: () => void;
  onUseSummary: () => void;
  onDismissSummary: () => void;
  onNvidiaApiKeyChange: (value: string) => void;
  onSaveNvidiaApiKey: () => void;
  onAmendChange: (value: boolean) => void;
  onResetModeChange: (mode: "soft" | "hard") => void;
  onCommit: () => void;
  onReset: () => void;
  onSetupRemote: () => void;
  disabled?: boolean;
};

export function CommitPanel({
  message,
  messageInputRef,
  branch,
  branches,
  amend,
  resetMode,
  selectedCommit,
  stagedCount,
  unstagedCount,
  changeCount,
  showCommitSection = true,
  showResetSection = false,
  showSetupRemote = false,
  nvidiaApiKey = "",
  nvidiaApiKeyConfigured = false,
  changeSummary = null,
  changeSummaryLoading = false,
  changeSummaryError = null,
  changeSummaryVisible = false,
  onMessageChange,
  onMessageFocus,
  onUseSummary,
  onDismissSummary,
  onNvidiaApiKeyChange,
  onSaveNvidiaApiKey,
  onAmendChange,
  onResetModeChange,
  onCommit,
  onReset,
  onSetupRemote,
  disabled,
}: CommitPanelProps) {
  const [showKeyInput, setShowKeyInput] = useState(false);
  const canCommit = (stagedCount > 0 || amend) && message.trim().length > 0;
  const localBranches = branches.filter((b) => !b.isRemote);
  const resetLabel = resetMode === "soft" ? "Soft Reset" : "Hard Reset";
  const showSummaryPanel =
    showCommitSection && changeCount > 0 && (changeSummaryVisible || changeSummaryLoading);

  useEffect(() => {
    if (nvidiaApiKeyConfigured) {
      setShowKeyInput(false);
    }
  }, [nvidiaApiKeyConfigured]);

  useEffect(() => {
    if (!showCommitSection) return;

    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canCommit && !disabled) {
        event.preventDefault();
        onCommit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canCommit, disabled, onCommit, showCommitSection]);

  async function openNvidiaLink(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    await openUrl(NVIDIA_MODELS_URL);
  }

  function toggleKeyInput() {
    if (nvidiaApiKeyConfigured) return;
    setShowKeyInput((current) => !current);
  }

  const panelTitle = nvidiaApiKeyConfigured ? "What's in this" : "AI Auto Summarize";

  return (
    <aside className="commit-panel">
      {showCommitSection ? (
        <section className="panel-block">
          <header className="panel-title">
            <GitCommitHorizontal size={14} />
            <span>Commit</span>
          </header>

          <label className="field-label" htmlFor="commit-message">
            Message
          </label>
          <textarea
            id="commit-message"
            ref={messageInputRef}
            className="commit-message-input"
            value={message}
            onChange={(event) => onMessageChange(event.currentTarget.value)}
            onFocus={onMessageFocus}
            placeholder="Commit message"
            rows={4}
            disabled={disabled}
          />

          {showSummaryPanel ? (
            <div className="change-summary-panel">
              <div className="change-summary-header">
                <button
                  type="button"
                  className="change-summary-icon-btn"
                  onClick={toggleKeyInput}
                  title={
                    nvidiaApiKeyConfigured
                      ? "AI summary"
                      : showKeyInput
                        ? "Hide API key field"
                        : "Paste NVIDIA API key"
                  }
                  aria-expanded={showKeyInput}
                  aria-label={
                    nvidiaApiKeyConfigured ? "AI summary" : "Toggle NVIDIA API key field"
                  }
                  disabled={nvidiaApiKeyConfigured}
                >
                  <Sparkles size={13} />
                </button>
                <span className="change-summary-title">{panelTitle}</span>
                {changeSummaryLoading ? <Loader2 size={13} className="spin" /> : null}
                <button
                  type="button"
                  className="change-summary-dismiss icon-btn"
                  onClick={onDismissSummary}
                  title="Hide"
                  aria-label={nvidiaApiKeyConfigured ? "Hide summary" : "Hide AI setup"}
                >
                  <X size={14} />
                </button>
              </div>

              {!nvidiaApiKeyConfigured ? (
                <>
                  <p className="change-summary-body muted">
                    Sign in at{" "}
                    <a
                      href={NVIDIA_MODELS_URL}
                      className="change-summary-link"
                      onClick={(event) => void openNvidiaLink(event)}
                    >
                      NVIDIA
                    </a>
                    , grab a free API key, then tap{" "}
                    <Sparkles size={11} className="change-summary-inline-icon" aria-hidden /> above
                    to paste it here — or open Settings → Auto Summarize.
                  </p>

                  {showKeyInput ? (
                    <form
                      className="change-summary-key-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        onSaveNvidiaApiKey();
                      }}
                    >
                      <input
                        type="password"
                        value={nvidiaApiKey}
                        onChange={(event) => onNvidiaApiKeyChange(event.currentTarget.value)}
                        placeholder="Paste NVIDIA API key"
                        aria-label="NVIDIA API key"
                        autoComplete="off"
                        disabled={disabled}
                        autoFocus
                      />
                      <button
                        type="submit"
                        className="action-btn"
                        disabled={disabled || !nvidiaApiKey.trim()}
                      >
                        Save key
                      </button>
                    </form>
                  ) : null}

                  {changeSummaryError ? (
                    <p className="change-summary-body error">{changeSummaryError}</p>
                  ) : null}
                </>
              ) : (
                <>
                  {changeSummaryLoading && !changeSummary ? (
                    <p className="change-summary-body muted">Summarizing changes…</p>
                  ) : null}

                  {changeSummaryError ? (
                    <p className="change-summary-body error">{changeSummaryError}</p>
                  ) : null}

                  {changeSummary ? (
                    <>
                      <button
                        type="button"
                        className="change-summary-body change-summary-use"
                        onClick={onUseSummary}
                        disabled={disabled}
                        title="Use as commit message"
                      >
                        {changeSummary}
                      </button>
                      <p className="change-summary-hint muted">Click to use as commit message</p>
                    </>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          <label className="field-label">Commit to</label>
          <select className="branch-select" value={branch} disabled>
            {localBranches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>

          <label className="amend-check">
            <input
              type="checkbox"
              checked={amend}
              onChange={(event) => onAmendChange(event.currentTarget.checked)}
              disabled={disabled}
            />
            Amend last commit
          </label>

          <button
            type="button"
            className="commit-primary"
            disabled={disabled || !canCommit}
            onClick={onCommit}
          >
            Commit
            <kbd>⌘↵</kbd>
          </button>
        </section>
      ) : null}

      {showSetupRemote ? (
        <section className="panel-block">
          <header className="panel-title">
            <Link2 size={14} />
            <span>Remote</span>
          </header>
          <button type="button" className="action-row" disabled={disabled} onClick={onSetupRemote}>
            <Link2 size={15} />
            <span>Set Up Remote</span>
          </button>
        </section>
      ) : null}

      {showResetSection && selectedCommit ? (
        <section className="panel-block reset-block">
          <header className="panel-title">
            <RotateCcw size={14} />
            <span>Reset Branch</span>
          </header>

          <p className="reset-context">
            Move <strong>{branch}</strong> to this commit:
          </p>

          <div className="reset-target" title={selectedCommit.subject}>
            <code>{selectedCommit.shortHash}</code>
            <span>{selectedCommit.subject}</span>
          </div>

          <label className="field-label">Mode</label>
          <div className="reset-toggle">
            <button
              type="button"
              className={resetMode === "soft" ? "active" : ""}
              onClick={() => onResetModeChange("soft")}
            >
              Soft
            </button>
            <button
              type="button"
              className={`${resetMode === "hard" ? "active hard" : ""}`}
              onClick={() => onResetModeChange("hard")}
            >
              Hard
            </button>
          </div>

          <p className="reset-mode-hint">
            {resetMode === "soft"
              ? "Keeps your staged and unstaged changes."
              : "Discards all uncommitted changes."}
          </p>

          {resetMode === "hard" && (stagedCount > 0 || unstagedCount > 0) ? (
            <p className="reset-warning">
              This will discard {stagedCount} staged and {unstagedCount} unstaged changes.
            </p>
          ) : null}

          <button
            type="button"
            className={`reset-primary ${resetMode === "hard" ? "danger" : "warn"}`}
            disabled={disabled}
            onClick={onReset}
          >
            <RotateCcw size={15} />
            {resetLabel}
          </button>
        </section>
      ) : null}
    </aside>
  );
}
