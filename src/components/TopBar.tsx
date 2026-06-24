import {
  ChevronDown,
  GitBranch,
  GitCompareArrows,
  History,
  Link2,
  RefreshCw,
  Settings,
} from "lucide-react";
import type { CommitEntry, RepoEntry } from "../types";
import { PushButton, type PushPhase } from "./PushButton";
import { RepoPicker } from "./RepoPicker";
import { WorkingTreePicker } from "./WorkingTreePicker";

type TopBarProps = {
  repos: RepoEntry[];
  selectedPath: string;
  branch: string;
  branches: string[];
  commits: CommitEntry[];
  aheadCommits?: CommitEntry[];
  aheadBranch?: string | null;
  changeCount: number;
  viewMode: "working" | "history";
  viewingCommit?: CommitEntry | null;
  loading?: boolean;
  pushPhase?: PushPhase;
  ahead?: number;
  behind?: number;
  unpushedTags?: number;
  hasRemotes?: boolean;
  onRepoChange: (path: string) => void;
  onBranchChange: (branch: string) => void;
  onToggleView: () => void;
  onReturnToWorkingTree: () => void;
  onSelectCommit: (commit: CommitEntry) => void;
  onResumeBranch?: () => void;
  onRefresh: () => void;
  onPush?: () => Promise<boolean>;
  onForcePush?: () => Promise<boolean>;
  onSetupRemote?: () => void;
  onOpenRepoSettings?: () => void;
};

export function TopBar({
  repos,
  selectedPath,
  branch,
  branches,
  commits,
  aheadCommits = [],
  aheadBranch,
  changeCount,
  viewMode,
  viewingCommit,
  loading,
  pushPhase = "idle",
  ahead = 0,
  behind = 0,
  unpushedTags = 0,
  hasRemotes = false,
  onRepoChange,
  onBranchChange,
  onToggleView,
  onReturnToWorkingTree,
  onSelectCommit,
  onResumeBranch,
  onRefresh,
  onPush,
  onForcePush,
  onSetupRemote,
  onOpenRepoSettings,
}: TopBarProps) {
  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <button
          type="button"
          className={`view-mode-toggle ${viewMode}`}
          title={viewMode === "working" ? "Switch to history" : "Switch to working tree"}
          aria-label={viewMode === "working" ? "Switch to history" : "Switch to working tree"}
          onClick={onToggleView}
        >
          {viewMode === "working" ? <History size={15} /> : <GitCompareArrows size={15} />}
        </button>

        <RepoPicker repos={repos} selectedPath={selectedPath} onChange={onRepoChange} />

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
            <WorkingTreePicker
              commits={commits}
              aheadCommits={aheadCommits}
              aheadBranch={aheadBranch}
              branch={branch}
              viewingCommit={viewingCommit}
              changeCount={changeCount}
              onSelectWorkingTree={onReturnToWorkingTree}
              onSelectCommit={onSelectCommit}
              onResumeBranch={onResumeBranch}
            />
          </>
        ) : null}
      </div>

      <div className="top-bar-right">
        {(aheadCommits.length > 0 && aheadBranch && onResumeBranch) ? (
          <button
            type="button"
            className="resume-branch-btn"
            title={`Return to latest commit on ${aheadBranch}`}
            disabled={loading}
            onClick={onResumeBranch}
          >
            <GitBranch size={14} />
            Return to {aheadBranch}
            <em>{aheadCommits.length}</em>
          </button>
        ) : null}
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
        {onPush && onForcePush ? (
          <PushButton
            ahead={ahead}
            behind={behind}
            unpushedTags={unpushedTags}
            hasRemotes={hasRemotes}
            pushPhase={pushPhase}
            loading={loading}
            onPush={onPush}
            onForcePush={onForcePush}
          />
        ) : null}
        {!hasRemotes && onSetupRemote ? (
          <button
            type="button"
            className="setup-remote-btn"
            title="Add a remote to push commits"
            disabled={loading}
            onClick={onSetupRemote}
          >
            <Link2 size={14} />
            Add remote
          </button>
        ) : null}
        {onOpenRepoSettings ? (
          <button
            type="button"
            className="ghost-btn"
            title="Repository settings"
            disabled={loading}
            onClick={onOpenRepoSettings}
          >
            <Settings size={15} />
          </button>
        ) : null}
      </div>
    </header>
  );
}
