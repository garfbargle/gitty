import {
  ChevronDown,
  GitBranch,
  Link2,
  PanelLeft,
  PanelLeftClose,
  RefreshCw,
  Settings,
} from "lucide-react";
import type { CommitEntry, RepoEntry } from "../types";
import { IdePicker } from "./IdePicker";
import { PushButton, type PushPhase } from "./PushButton";
import { RepoPicker } from "./RepoPicker";

type TopBarProps = {
  repos: RepoEntry[];
  selectedPath: string;
  branch: string;
  branches: string[];
  changeCount: number;
  viewingCommit?: CommitEntry | null;
  loading?: boolean;
  pushPhase?: PushPhase;
  repoSwitching?: boolean;
  ahead?: number;
  behind?: number;
  unpushedTags?: number;
  hasRemotes?: boolean;
  branchUnpublished?: boolean;
  forceSuggested?: boolean;
  onRepoChange: (path: string) => void;
  onBranchChange: (branch: string) => void;
  onReturnToWorkingTree: () => void;
  onOpenVersion?: () => void;
  onRefresh: () => void;
  onPush?: () => Promise<boolean>;
  onForcePush?: () => Promise<boolean>;
  onOverwrite?: () => Promise<boolean>;
  onSetupRemote?: () => void;
  onOpenRepoSettings?: () => void;
  sidebarVisible?: boolean;
  onToggleSidebar?: () => void;
};

export function TopBar({
  repos,
  selectedPath,
  branch,
  branches,
  changeCount,
  viewingCommit,
  loading,
  pushPhase = "idle",
  repoSwitching = false,
  ahead = 0,
  behind = 0,
  unpushedTags = 0,
  hasRemotes = false,
  branchUnpublished = false,
  forceSuggested = false,
  onRepoChange,
  onBranchChange,
  onReturnToWorkingTree,
  onOpenVersion,
  onRefresh,
  onPush,
  onForcePush,
  onOverwrite,
  onSetupRemote,
  onOpenRepoSettings,
  sidebarVisible = true,
  onToggleSidebar,
}: TopBarProps) {
  const inPreview = !!viewingCommit;
  const previewBranchLabel = branch.includes("detached") ? "latest" : branch;

  return (
    <header className={`top-bar${inPreview ? " preview-mode" : ""}`}>
      <div className="top-bar-left">
        {onToggleSidebar ? (
          <button
            type="button"
            className="view-mode-toggle"
            title={sidebarVisible ? "Hide repositories" : "Show repositories"}
            aria-label={sidebarVisible ? "Hide repositories" : "Show repositories"}
            aria-pressed={sidebarVisible}
            onClick={onToggleSidebar}
          >
            {sidebarVisible ? <PanelLeftClose size={15} /> : <PanelLeft size={15} />}
          </button>
        ) : null}

        <IdePicker repoPath={selectedPath} />

        <RepoPicker repos={repos} selectedPath={selectedPath} onChange={onRepoChange} />

        <span className="breadcrumb-sep">›</span>

        <div className="select-wrap">
          <GitBranch size={14} className="branch-icon" />
          <select
            className="top-select branch-select-top"
            value={branch}
            disabled={repoSwitching || loading}
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

        {inPreview && viewingCommit ? (
          <>
            <span className="breadcrumb-sep">›</span>
            <div className="preview-banner" role="status">
              <span className="preview-label">Viewing</span>
              <code>{viewingCommit.shortHash}</code>
              <span className="preview-meta">· now on {previewBranchLabel}</span>
            </div>
          </>
        ) : null}
      </div>

      <div className="top-bar-right">
        {inPreview && onOpenVersion ? (
          <button
            type="button"
            className="visit-commit-btn"
            title="Open this version's files in a folder"
            disabled={loading}
            onClick={onOpenVersion}
          >
            Open in folder
          </button>
        ) : null}
        {inPreview ? (
          <button
            type="button"
            className="return-to-changes-btn"
            title="Back to your current work"
            onClick={onReturnToWorkingTree}
          >
            <span className="working-dot" />
            Back to now
            {changeCount > 0 ? <em>{changeCount}</em> : null}
          </button>
        ) : null}
        <button type="button" className="ghost-btn" title="Refresh" disabled={loading || repoSwitching} onClick={onRefresh}>
          <RefreshCw size={15} className={loading || repoSwitching ? "spin" : ""} />
        </button>
        {onPush && onForcePush && onOverwrite && !repoSwitching ? (
          <PushButton
            ahead={ahead}
            behind={behind}
            unpushedTags={unpushedTags}
            hasRemotes={hasRemotes}
            unpublished={branchUnpublished}
            forceSuggested={forceSuggested}
            pushPhase={pushPhase}
            loading={loading}
            onPush={onPush}
            onForcePush={onForcePush}
            onOverwrite={onOverwrite}
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
