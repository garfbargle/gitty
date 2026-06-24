import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDate } from "../lib/git";
import type { CommitEntry } from "../types";

type WorkingTreePickerProps = {
  commits: CommitEntry[];
  viewingCommit?: CommitEntry | null;
  changeCount: number;
  onSelectWorkingTree: () => void;
  onSelectCommit: (commit: CommitEntry) => void;
};

export function WorkingTreePicker({
  commits,
  viewingCommit,
  changeCount,
  onSelectWorkingTree,
  onSelectCommit,
}: WorkingTreePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function selectWorkingTree() {
    setOpen(false);
    onSelectWorkingTree();
  }

  function selectCommit(commit: CommitEntry) {
    setOpen(false);
    onSelectCommit(commit);
  }

  const workingTreeActive = !viewingCommit;

  return (
    <div className={`working-tree-picker ${open ? "open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className={`working-tree-trigger ${workingTreeActive ? "active" : ""}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((value) => !value)}
      >
        {viewingCommit ? (
          <>
            <code>{viewingCommit.shortHash}</code>
            <span className="trigger-subject">{viewingCommit.subject}</span>
          </>
        ) : (
          <>
            <span className="working-dot" />
            <span>Working Tree</span>
            {changeCount > 0 ? <em>{changeCount}</em> : null}
          </>
        )}
        <ChevronDown size={14} className="picker-chevron" />
      </button>

      {open ? (
        <div className="working-tree-menu" role="listbox">
          <button
            type="button"
            role="option"
            aria-selected={workingTreeActive}
            className={`working-tree-option ${workingTreeActive ? "active" : ""}`}
            onClick={selectWorkingTree}
          >
            <span className="option-leading">
              <span className="working-dot" />
              <span className="option-label">Working Tree</span>
            </span>
            <span className="option-meta">
              {changeCount > 0 ? `${changeCount} change${changeCount === 1 ? "" : "s"}` : "No changes"}
            </span>
          </button>

          {commits.length > 0 ? <div className="working-tree-menu-divider" aria-hidden="true" /> : null}

          <div className="working-tree-commit-list">
            {commits.map((commit) => {
              const active = viewingCommit?.hash === commit.hash;
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`working-tree-option commit ${active ? "active" : ""}`}
                  key={commit.hash}
                  onClick={() => selectCommit(commit)}
                  title={`${commit.subject} · ${formatDate(commit.date)}`}
                >
                  <code>{commit.shortHash}</code>
                  <span className="option-body">
                    <span className="option-label">{commit.subject}</span>
                    <span className="option-meta">{formatDate(commit.date)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
