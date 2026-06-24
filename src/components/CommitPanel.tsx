import { useEffect, type RefObject } from "react";
import {
  AlertTriangle,
  GitCommitHorizontal,
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
  onMessageChange: (value: string) => void;
  onAmendChange: (value: boolean) => void;
  onResetModeChange: (mode: "soft" | "hard") => void;
  onCommit: () => void;
  onPush: () => void;
  onForcePush: () => void;
  onReset: () => void;
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
  onMessageChange,
  onAmendChange,
  onResetModeChange,
  onCommit,
  onPush,
  onForcePush,
  onReset,
  disabled,
}: CommitPanelProps) {
  const canCommit = (stagedCount > 0 || amend) && message.trim().length > 0;
  const localBranches = branches.filter((b) => !b.isRemote);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canCommit && !disabled) {
        event.preventDefault();
        onCommit();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canCommit, disabled, onCommit]);

  return (
    <aside className="commit-panel">
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

      <section className="panel-block">
        <header className="panel-title">Actions</header>
        <button type="button" className="action-row" disabled={disabled} onClick={onPush}>
          <Send size={15} />
          <span>Push</span>
          <kbd>⌘⇧P</kbd>
        </button>
        <button type="button" className="action-row danger" disabled={disabled} onClick={onForcePush}>
          <AlertTriangle size={15} />
          <span>Force Push</span>
          <kbd>⌥⇧P</kbd>
        </button>
        <button
          type="button"
          className="action-row warn"
          disabled={disabled || !selectedCommit}
          onClick={onReset}
        >
          <RotateCcw size={15} />
          <span>Reset Current Branch</span>
        </button>
      </section>

      <section className="panel-block reset-block">
        <header className="panel-title">Reset to Commit</header>
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
        {resetMode === "hard" && (stagedCount > 0 || unstagedCount > 0) ? (
          <p className="reset-warning">
            This will discard {stagedCount} staged and {unstagedCount} unstaged changes.
          </p>
        ) : null}
        <select className="branch-select" value={selectedCommit?.hash ?? ""} disabled>
          <option value="">
            {selectedCommit
              ? `${selectedCommit.shortHash} · ${selectedCommit.subject}`
              : "Select commit from history"}
          </option>
        </select>
      </section>
    </aside>
  );
}
