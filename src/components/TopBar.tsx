import { ChevronDown, GitBranch, History, RefreshCw } from "lucide-react";
import type { CommitEntry, RepoEntry } from "../types";

type TopBarProps = {
  repos: RepoEntry[];
  selectedPath: string;
  branch: string;
  branches: string[];
  changeCount: number;
  viewMode: "working" | "history";
  viewingCommit?: CommitEntry | null;
  loading?: boolean;
  onRepoChange: (path: string) => void;
  onBranchChange: (branch: string) => void;
  onToggleView: () => void;
  onReturnToWorkingTree: () => void;
  onRefresh: () => void;
};

export function TopBar({
  repos,
  selectedPath,
  branch,
  branches,
  changeCount,
  viewMode,
  viewingCommit,
  loading,
  onRepoChange,
  onBranchChange,
  onToggleView,
  onReturnToWorkingTree,
  onRefresh,
}: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <div className="select-wrap">
          <select
            className="top-select repo-select"
            value={selectedPath}
            onChange={(event) => onRepoChange(event.currentTarget.value)}
          >
            {repos.map((repo) => (
              <option key={repo.id} value={repo.path}>
                {repo.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="select-chevron" />
        </div>

        <span className="breadcrumb-sep">›</span>

        <div className="select-wrap">
          <GitBranch size={14} className="branch-icon" />
          <select
            className="top-select branch-select-top"
            value={branch}
            onChange={(event) => onBranchChange(event.currentTarget.value)}
          >
            {branches.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="select-chevron" />
        </div>

        {viewMode === "working" ? (
          <>
            <span className="breadcrumb-sep">›</span>
            {viewingCommit ? (
              <span className="commit-crumb" title={viewingCommit.subject}>
                <code>{viewingCommit.shortHash}</code>
                <span>{viewingCommit.subject}</span>
              </span>
            ) : (
              <span className="working-badge">
                <span className="working-dot" />
                Working Tree
                {changeCount > 0 ? <em>{changeCount}</em> : null}
              </span>
            )}
          </>
        ) : null}
      </div>

      <div className="top-bar-right">
        {viewMode === "working" && viewingCommit ? (
          <button
            type="button"
            className="return-to-changes-btn"
            title="Return to current changes"
            onClick={onReturnToWorkingTree}
          >
            <span className="working-dot" />
            Current Changes
            {changeCount > 0 ? <em>{changeCount}</em> : null}
          </button>
        ) : null}
        <button type="button" className="ghost-btn" title="Refresh" disabled={loading} onClick={onRefresh}>
          <RefreshCw size={15} className={loading ? "spin" : ""} />
        </button>
        <button type="button" className="ghost-btn" onClick={onToggleView}>
          <History size={15} />
          {viewMode === "working" ? "Back to History" : "Working Tree"}
        </button>
      </div>
    </header>
  );
}
