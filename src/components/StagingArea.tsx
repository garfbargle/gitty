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

function FileList({
  files,
  selectedPath,
  checked,
  onToggle,
  onSelect,
  variant,
}: {
  files: FileChange[];
  selectedPath?: string;
  checked: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (file: FileChange) => void;
  variant: "staged" | "unstaged";
}) {
  if (files.length === 0) {
    return <p className="empty-list">No files</p>;
  }

  return (
    <div className="staging-files">
      {files.map((file) => (
        <div
          className={`staging-file ${selectedPath === file.path ? "selected" : ""}`}
          key={`${variant}-${file.path}`}
        >
          <label className="file-check">
            <input
              type="checkbox"
              checked={checked.has(file.path)}
              onChange={() => onToggle(file.path)}
            />
          </label>
          <button className="file-name" type="button" onClick={() => onSelect(file)} title={file.path}>
            <span className={`file-status ${statusCode(file.status).toLowerCase()}`}>
              {statusCode(file.status)}
            </span>
            <span>{file.path}</span>
          </button>
        </div>
      ))}
    </div>
  );
}

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
  const canCommit = (staged.length > 0 || amend) && commitMessage.trim().length > 0;

  const [checkedUnstaged, setCheckedUnstaged] = useStateSet(unstaged.map((f) => f.path));
  const [checkedStaged, setCheckedStaged] = useStateSet(staged.map((f) => f.path));

  function toggleUnstaged(path: string) {
    const next = new Set(checkedUnstaged);
    if (next.has(path)) {
      next.delete(path);
      setCheckedUnstaged(next);
    } else {
      next.add(path);
      setCheckedUnstaged(next);
      void onStage([path]);
    }
  }

  function toggleStaged(path: string) {
    const next = new Set(checkedStaged);
    if (next.has(path)) {
      next.delete(path);
      setCheckedStaged(next);
    } else {
      next.add(path);
      setCheckedStaged(next);
      void onUnstage([path]);
    }
  }

  return (
    <section className="staging-area">
      <div className="staging-column">
        <header className="staging-header">
          <span>Unstaged Changes ({unstaged.length})</span>
        </header>
        <FileList
          files={unstaged}
          selectedPath={selectedPath}
          checked={checkedUnstaged}
          onToggle={toggleUnstaged}
          onSelect={onSelect}
          variant="unstaged"
        />
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
        <FileList
          files={staged}
          selectedPath={selectedPath}
          checked={checkedStaged}
          onToggle={toggleStaged}
          onSelect={onSelect}
          variant="staged"
        />
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

function useStateSet(initial: string[]) {
  const [set, setSet] = useState(() => new Set(initial));
  return [set, setSet] as const;
}

import { useEffect, useState } from "react";

// Keep checked sets in sync when file lists change
function StagingAreaWrapper(props: StagingAreaProps) {
  return <StagingAreaInner {...props} />;
}

function StagingAreaInner(props: StagingAreaProps) {
  const staged = props.changes.filter(isStaged);
  const unstaged = props.changes.filter(isUnstaged);
  const [checkedUnstaged, setCheckedUnstaged] = useState<Set<string>>(new Set());
  const [checkedStaged, setCheckedStaged] = useState<Set<string>>(new Set());

  useEffect(() => {
    setCheckedUnstaged(new Set(unstaged.map((f) => f.path)));
  }, [unstaged.map((f) => f.path).join("|")]);

  useEffect(() => {
    setCheckedStaged(new Set(staged.map((f) => f.path)));
  }, [staged.map((f) => f.path).join("|")]);

  function toggleUnstaged(path: string) {
    if (checkedUnstaged.has(path)) {
      const next = new Set(checkedUnstaged);
      next.delete(path);
      setCheckedUnstaged(next);
    } else {
      setCheckedUnstaged(new Set([...checkedUnstaged, path]));
      void props.onStage([path]);
    }
  }

  function toggleStaged(path: string) {
    if (checkedStaged.has(path)) {
      const next = new Set(checkedStaged);
      next.delete(path);
      setCheckedStaged(next);
      void props.onUnstage([path]);
    } else {
      setCheckedStaged(new Set([...checkedStaged, path]));
    }
  }

  const canCommit =
    (staged.length > 0 || props.amend) && props.commitMessage.trim().length > 0;

  return (
    <section className="staging-area">
      <div className="staging-column">
        <header className="staging-header">
          <span>Unstaged Changes ({unstaged.length})</span>
        </div>
        <div className="staging-files">
          {unstaged.length === 0 ? (
            <p className="empty-list">No unstaged changes</p>
          ) : (
            unstaged.map((file) => (
              <div
                className={`staging-file ${props.selectedPath === file.path ? "selected" : ""}`}
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
                  onClick={() => props.onSelect(file)}
                  title={file.path}
                >
                  <span className={`file-status ${statusCode(file.status).toLowerCase()}`}>
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
            disabled={props.disabled || staged.length === 0}
            onClick={props.onUnstageAll}
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
                className={`staging-file ${props.selectedPath === file.path ? "selected" : ""}`}
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
                  onClick={() => props.onSelect(file)}
                  title={file.path}
                >
                  <span className={`file-status ${statusCode(file.status).toLowerCase()}`}>
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
            props.onCommit();
          }}
        >
          <textarea
            value={props.commitMessage}
            onChange={(event) => props.onCommitMessageChange(event.currentTarget.value)}
            placeholder="Describe your changes…"
            rows={5}
            disabled={props.disabled}
          />
          <label className="amend-row">
            <input
              type="checkbox"
              checked={props.amend}
              onChange={(event) => props.onAmendChange(event.currentTarget.checked)}
              disabled={props.disabled}
            />
            Amend last commit
          </label>
          <button type="submit" className="commit-btn" disabled={props.disabled || !canCommit}>
            Commit
            <CornerDownLeft size={14} />
          </button>
        </form>
      </div>
    </section>
  );
}

export { StagingAreaInner as StagingArea };
