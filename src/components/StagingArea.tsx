import { useEffect, useState } from "react";
import { CornerDownLeft } from "lucide-react";
import type { FileChange } from "../types";
import { isStaged, isUnstaged, statusCode } from "../lib/git";

type StagingAreaProps = {
  changes: FileChange[];
  selectedPath?: string;
  commitMessage: string;
  amend: boolean;
  onCommitMessageChange: (value: string) => void;
  onAmendChange: (value: boolean) => void;
  onSelect: (file: FileChange) => void;
  onStage: (files: string[]) => void;
  onUnstage: (files: string[]) => void;
  onUnstageAll: () => void;
  onCommit: () => void;
  disabled?: boolean;
};

export function StagingArea({
  changes,
  selectedPath,
  commitMessage,
  amend,
  onCommitMessageChange,
  onAmendChange,
  onSelect,
  onStage,
  onUnstage,
  onUnstageAll,
  onCommit,
  disabled,
}: StagingAreaProps) {
  const staged = changes.filter(isStaged);
  const unstaged = changes.filter(isUnstaged);
  const [checkedUnstaged, setCheckedUnstaged] = useState<Set<string>>(new Set());
  const [checkedStaged, setCheckedStaged] = useState<Set<string>>(new Set());

  useEffect(() => {
    setCheckedUnstaged(new Set(changes.filter(isUnstaged).map((file) => file.path)));
  }, [changes]);

  useEffect(() => {
    setCheckedStaged(new Set(changes.filter(isStaged).map((file) => file.path)));
  }, [changes]);

  const canCommit = (staged.length > 0 || amend) && commitMessage.trim().length > 0;

  function toggleUnstaged(path: string) {
    if (checkedUnstaged.has(path)) {
      const next = new Set(checkedUnstaged);
      next.delete(path);
      setCheckedUnstaged(next);
    } else {
      setCheckedUnstaged(new Set([...checkedUnstaged, path]));
      void onStage([path]);
    }
  }

  function toggleStaged(path: string) {
    if (checkedStaged.has(path)) {
      const next = new Set(checkedStaged);
      next.delete(path);
      setCheckedStaged(next);
      void onUnstage([path]);
    } else {
      setCheckedStaged(new Set([...checkedStaged, path]));
    }
  }

  return (
    <section className="staging-area">
      <div className="staging-column">
        <header className="staging-header">
          <span>Unstaged Changes ({unstaged.length})</span>
        </header>
        <div className="staging-files">
          {unstaged.length === 0 ? (
            <p className="empty-list">No unstaged changes</p>
          ) : (
            unstaged.map((file) => (
              <div
                className={`staging-file ${selectedPath === file.path ? "selected" : ""}`}
                key={`u-${file.path}`}
              >
                <label className="file-check">
                  <input
                    type="checkbox"
                    checked={checkedUnstaged.has(file.path)}
                    onChange={() => toggleUnstaged(file.path)}
                  />
                </label>
                <button
                  className="file-name"
                  type="button"
                  onClick={() => onSelect(file)}
                  title={file.path}
                >
                  <span className={`file-status ${statusCode(file.status).toLowerCase() === "?" ? "untracked" : statusCode(file.status).toLowerCase()}`}>
                    {statusCode(file.status)}
                  </span>
                  <span>{file.path}</span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="staging-column">
        <header className="staging-header">
          <span>Staged Changes ({staged.length})</span>
          <button
            type="button"
            className="link-btn"
            disabled={disabled || staged.length === 0}
            onClick={onUnstageAll}
          >
            Unstage All
          </button>
        </header>
        <div className="staging-files">
          {staged.length === 0 ? (
            <p className="empty-list">Nothing staged</p>
          ) : (
            staged.map((file) => (
              <div
                className={`staging-file ${selectedPath === file.path ? "selected" : ""}`}
                key={`s-${file.path}`}
              >
                <label className="file-check">
                  <input
                    type="checkbox"
                    checked={checkedStaged.has(file.path)}
                    onChange={() => toggleStaged(file.path)}
                  />
                </label>
                <button
                  className="file-name"
                  type="button"
                  onClick={() => onSelect(file)}
                  title={file.path}
                >
                  <span className={`file-status ${statusCode(file.status).toLowerCase() === "?" ? "untracked" : statusCode(file.status).toLowerCase()}`}>
                    {statusCode(file.status)}
                  </span>
                  <span>{file.path}</span>
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="staging-column commit-column">
        <header className="staging-header">
          <span>Commit Message</span>
        </header>
        <form
          className="commit-form"
          onSubmit={(event) => {
            event.preventDefault();
            onCommit();
          }}
        >
          <textarea
            value={commitMessage}
            onChange={(event) => onCommitMessageChange(event.currentTarget.value)}
            placeholder="Describe your changes…"
            rows={5}
            disabled={disabled}
          />
          <label className="amend-row">
            <input
              type="checkbox"
              checked={amend}
              onChange={(event) => onAmendChange(event.currentTarget.checked)}
              disabled={disabled}
            />
            Amend last commit
          </label>
          <button type="submit" className="commit-btn" disabled={disabled || !canCommit}>
            Commit
            <CornerDownLeft size={14} />
          </button>
        </form>
      </div>
    </section>
  );
}
