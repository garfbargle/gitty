import { ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { aheadCommitHashes, pickerCommits } from "../lib/commitDisplay";
import { formatDate } from "../lib/git";
import type { CommitEntry } from "../types";

type WorkingTreePickerProps = {
  commits: CommitEntry[];
  aheadCommits?: CommitEntry[];
  aheadBranch?: string | null;
  branch?: string;
  viewingCommit?: CommitEntry | null;
  changeCount: number;
  onSelectWorkingTree: () => void;
  onSelectCommit: (commit: CommitEntry) => void;
  onResumeBranch?: () => void;
};

export function WorkingTreePicker({
  commits,
  aheadCommits = [],
  aheadBranch,
  branch,
  viewingCommit,
  changeCount,
  onSelectWorkingTree,
  onSelectCommit,
  onResumeBranch,
}: WorkingTreePickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const visibleCommits = useMemo(
    () => pickerCommits(commits, aheadCommits),
    [commits, aheadCommits],
  );
  const aheadHashes = useMemo(() => aheadCommitHashes(aheadCommits), [aheadCommits]);
  const onCurrentBranch = Boolean(
    aheadBranch && branch && !branch.includes("detached") && branch === aheadBranch,
  );

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

          {visibleCommits.length > 0 ? <div className="working-tree-menu-divider" aria-hidden="true" /> : null}

          {aheadCommits.length > 0 ? (
            <div className="working-tree-menu-section">
              <div className="working-tree-menu-heading">
                <span>
                  {aheadBranch
                    ? onCurrentBranch
                      ? `${aheadCommits.length} later commit${aheadCommits.length === 1 ? "" : "s"} on ${aheadBranch}`
                      : `${aheadCommits.length} commit${aheadCommits.length === 1 ? "" : "s"} ahead on ${aheadBranch}`
                    : `${aheadCommits.length} unreachable commit${aheadCommits.length === 1 ? "" : "s"}`}
                </span>
                {aheadBranch && onResumeBranch ? (
                  <button
                    type="button"
                    className="working-tree-resume-btn"
                    onClick={() => {
                      setOpen(false);
                      onResumeBranch();
                    }}
                  >
                    Go to {aheadBranch}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="working-tree-commit-list">
            {visibleCommits.map((commit) => {
              const active = viewingCommit?.hash === commit.hash;
              const isAhead = aheadHashes.has(commit.hash);
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`working-tree-option commit ${active ? "active" : ""} ${isAhead ? "ahead" : ""}`}
                  key={commit.hash}
                  onClick={() => selectCommit(commit)}
                  title={`${commit.subject} · ${formatDate(commit.date)}${isAhead ? " · ahead on branch" : ""}`}
                >
                  <code>{commit.shortHash}</code>
                  <span className="option-body">
                    <span className="option-label">
                      {commit.subject}
                      {isAhead ? <span className="option-ahead-badge">ahead</span> : null}
                    </span>
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
