import { Minus, Plus } from "lucide-react";
import type { FileChange } from "../types";
import { isStaged, isUnstaged, statusLabel, statusTone } from "../lib/git";

type ChangesPanelProps = {
  changes: FileChange[];
  selectedPath?: string;
  commitMessage: string;
  onCommitMessageChange: (value: string) => void;
  onSelect: (file: FileChange) => void;
  onStage: (files: string[]) => void;
  onUnstage: (files: string[]) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onCommit: () => void;
  disabled?: boolean;
};

function FileRow({
  file,
  active,
  action,
  onAction,
  onSelect,
  disabled,
}: {
  file: FileChange;
  active: boolean;
  action: "stage" | "unstage";
  onAction: () => void;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <div className={`file-row ${active ? "active" : ""}`}>
      <button className="file-select" type="button" onClick={onSelect} title={file.path}>
        <span className={`status-badge ${statusTone(file.status)}`}>
          {statusLabel(file.status)}
        </span>
        <span className="file-path">{file.path}</span>
      </button>
      <button
        type="button"
        className="icon-button"
        title={action === "stage" ? "Stage file" : "Unstage file"}
        disabled={disabled}
        onClick={onAction}
      >
        {action === "stage" ? <Plus size={14} /> : <Minus size={14} />}
      </button>
    </div>
  );
}

export function ChangesPanel({
  changes,
  selectedPath,
  commitMessage,
  onCommitMessageChange,
  onSelect,
  onStage,
  onUnstage,
  onStageAll,
  onUnstageAll,
  onCommit,
  disabled,
}: ChangesPanelProps) {
  const staged = changes.filter(isStaged);
  const unstaged = changes.filter(isUnstaged);
  const canCommit = staged.length > 0 && commitMessage.trim().length > 0;

  return (
    <section className="changes-panel">
      <div className="changes-section">
        <header className="changes-header">
          <span>Staged ({staged.length})</span>
          <div className="changes-actions">
            <button type="button" className="text-button" disabled={disabled || staged.length === 0} onClick={onUnstageAll}>
              Unstage all
            </button>
          </div>
        </header>
        <div className="file-list">
          {staged.length === 0 ? (
            <p className="muted empty-files">Nothing staged yet</p>
          ) : (
            staged.map((file) => (
              <FileRow
                key={`staged-${file.path}`}
                file={file}
                active={selectedPath === file.path}
                action="unstage"
                disabled={disabled}
                onSelect={() => onSelect(file)}
                onAction={() => onUnstage([file.path])}
              />
            ))
          )}
        </div>
      </div>

      <div className="changes-section">
        <header className="changes-header">
          <span>Unstaged ({unstaged.length})</span>
          <div className="changes-actions">
            <button type="button" className="text-button" disabled={disabled || unstaged.length === 0} onClick={onStageAll}>
              Stage all
            </button>
          </div>
        </header>
        <div className="file-list">
          {unstaged.length === 0 ? (
            <p className="muted empty-files">Working tree clean</p>
          ) : (
            unstaged.map((file) => (
              <FileRow
                key={`unstaged-${file.path}`}
                file={file}
                active={selectedPath === file.path}
                action="stage"
                disabled={disabled}
                onSelect={() => onSelect(file)}
                onAction={() => onStage([file.path])}
              />
            ))
          )}
        </div>
      </div>

      <form
        className="commit-box"
        onSubmit={(event) => {
          event.preventDefault();
          onCommit();
        }}
      >
        <textarea
          value={commitMessage}
          onChange={(event) => onCommitMessageChange(event.currentTarget.value)}
          placeholder="Commit message"
          rows={3}
          disabled={disabled}
        />
        <button type="submit" className="primary-button" disabled={disabled || !canCommit}>
          Commit {staged.length > 0 ? `(${staged.length})` : ""}
        </button>
      </form>
    </section>
  );
}
