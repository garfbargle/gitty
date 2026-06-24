import { useEffect, type RefObject } from "react";
import {
  AlertTriangle,
  GitCommitHorizontal,
  Link2,
  RotateCcw,
  Send,
} from "lucide-react";
import type { BranchEntry, CommitEntry } from "../types";

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
  showCommitSection?: boolean;
  showResetSection?: boolean;
  showPushActions?: boolean;
  showSetupRemote?: boolean;
  onMessageChange: (value: string) => void;
  onAmendChange: (value: boolean) => void;
  onResetModeChange: (mode: "soft" | "hard") => void;
  onCommit: () => void;
  onPush: () => void;
  onForcePush: () => void;
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
  showCommitSection = true,
  showResetSection = false,
  showPushActions = false,
  showSetupRemote = false,
  onMessageChange,
  onAmendChange,
  onResetModeChange,
  onCommit,
  onPush,
  onForcePush,
  onReset,
  onSetupRemote,
  disabled,
}: CommitPanelProps) {
  const canCommit = (stagedCount > 0 || amend) && message.trim().length > 0;
  const localBranches = branches.filter((b) => !b.isRemote);
  const resetLabel = resetMode === "soft" ? "Soft Reset" : "Hard Reset";

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
            placeholder="Commit message"
            rows={4}
            disabled={disabled}
          />

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

      {showPushActions || showSetupRemote ? (
        <section className="panel-block">
          <header className="panel-title">
            <Send size={14} />
            <span>Remote</span>
          </header>
          {showPushActions ? (
            <>
              <button type="button" className="action-row" disabled={disabled} onClick={onPush}>
                <Send size={15} />
                <span>Push</span>
                <kbd>⌘⇧P</kbd>
              </button>
              <button
                type="button"
                className="action-row danger"
                disabled={disabled}
                onClick={onForcePush}
              >
                <AlertTriangle size={15} />
                <span>Force Push</span>
                <kbd>⌥⇧P</kbd>
              </button>
            </>
          ) : (
            <button type="button" className="action-row" disabled={disabled} onClick={onSetupRemote}>
              <Link2 size={15} />
              <span>Set Up Remote</span>
            </button>
          )}
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
