import {
  ChevronDown,
  GitBranch,
  Link2,
  PanelLeft,
  PanelLeftClose,
  RefreshCw,
  Settings,
} from "lucide-react";
import type {
  ActionExecutionState,
  CommitEntry,
  LinkedFolder,
  RepoAction,
  RepoEntry,
  WorktreeEntry,
} from "../types";
import { folderName } from "../lib/git";
import { IdePicker } from "./IdePicker";
import { RepoRunner } from "./RepoRunner";
import { PullButton, type PullPhase } from "./PullButton";
import { PushButton, type PushPhase } from "./PushButton";
import { BackupButton } from "./BackupButton";
import { LinkedFolderUpdatesButton } from "./LinkedFolderUpdatesButton";
import { LinkedFolderPublishButton } from "./LinkedFolderPublishButton";
import { RepoPicker } from "./RepoPicker";

type TopBarProps = {
  repos: RepoEntry[];
  selectedPath: string;
  branch: string;
  branches: string[];
  /// Other checkouts of this repository, so the branch list can show which
  /// branches are already open in another folder.
  worktrees?: WorktreeEntry[];
  viewingCommit?: CommitEntry | null;
  loading?: boolean;
  pushPhase?: PushPhase;
  pullPhase?: PullPhase;
  repoSwitching?: boolean;
  fetching?: boolean;
  ahead?: number;
  behind?: number;
  unpushedTags?: number;
  hasRemotes?: boolean;
  hasUpstream?: boolean;
  branchUnpublished?: boolean;
  forceSuggested?: boolean;
  disabled?: boolean;
  onRepoChange: (path: string) => void;
  onBranchChange: (branch: string) => void;
  onRefresh: () => void;
  onPush?: () => Promise<boolean>;
  onForcePush?: () => Promise<boolean>;
  onOverwrite?: () => Promise<boolean>;
  backupSetupAvailable?: boolean;
  backupRemoteName?: string | null;
  backupPhase?: PushPhase;
  onSetupBackup?: () => Promise<boolean>;
  onPull?: () => Promise<boolean>;
  onPullMerge?: () => Promise<boolean>;
  onSetupRemote?: () => void;
  onOpenRepoSettings?: () => void;
  /** Linked folders whose source has moved on, surfaced as a top-bar chip. */
  linkedUpdates?: LinkedFolder[];
  linkedBusyPrefix?: string | null;
  onUpdateLinkedFolder?: (prefix: string) => Promise<void>;
  linkedPublishable?: LinkedFolder[];
  linkedPushBusyPrefix?: string | null;
  onPublishLinkedFolder?: (prefix: string) => Promise<void>;
  /** Deep-link from the chip to the Linked folders settings section. Kept
   * separate from `onOpenRepoSettings` so the chip doesn't drag in the top-bar
   * settings gear. */
  onManageLinkedFolders?: () => void;
  sidebarVisible?: boolean;
  onToggleSidebar?: () => void;
  repoActions?: RepoAction[];
  selectedRepoActionId?: string;
  activeExecution?: ActionExecutionState | null;
  onRunAction?: (action: RepoAction) => void;
  onSelectRepoAction?: (action: RepoAction) => void;
  onRunCustomCommand?: (command: string) => void;
};

export function TopBar({
  repos,
  selectedPath,
  branch,
  branches,
  worktrees = [],
  viewingCommit,
  loading,
  pushPhase = "idle",
  pullPhase = "idle",
  repoSwitching = false,
  fetching = false,
  ahead = 0,
  behind = 0,
  unpushedTags = 0,
  hasRemotes = false,
  hasUpstream = false,
  branchUnpublished = false,
  forceSuggested = false,
  disabled = false,
  onRepoChange,
  onBranchChange,
  onRefresh,
  onPush,
  onForcePush,
  onOverwrite,
  backupSetupAvailable = false,
  backupRemoteName,
  backupPhase = "idle",
  onSetupBackup,
  onPull,
  onPullMerge,
  onSetupRemote,
  onOpenRepoSettings,
  linkedUpdates = [],
  linkedBusyPrefix = null,
  onUpdateLinkedFolder,
  linkedPublishable = [],
  linkedPushBusyPrefix = null,
  onPublishLinkedFolder,
  onManageLinkedFolders,
  sidebarVisible = true,
  onToggleSidebar,
  repoActions = [],
  selectedRepoActionId = "",
  activeExecution = null,
  onRunAction,
  onSelectRepoAction,
  onRunCustomCommand,
}: TopBarProps) {
  const inPreview = !!viewingCommit;
  const previewBranchLabel = branch.includes("detached") ? "latest" : branch;

  // branch name -> the folder it's already checked out in, excluding this one.
  // Prunable entries are kept: git still refuses to check the branch out here
  // while the registration exists, so dropping them would leave the option
  // looking available and fail on click. They're marked, not hidden.
  const openElsewhere = new Map(
    worktrees
      .filter((entry) => !entry.isCurrent && entry.branch)
      .map((entry) => [entry.branch as string, entry]),
  );

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

        {onRunAction && onSelectRepoAction ? (
          <RepoRunner
            repoPath={selectedPath}
            actions={repoActions}
            selectedActionId={selectedRepoActionId}
            activeExecution={activeExecution}
            onRunAction={onRunAction}
            onSelectAction={onSelectRepoAction}
            onRunCustomCommand={onRunCustomCommand}
          />
        ) : null}

        <RepoPicker repos={repos} selectedPath={selectedPath} onChange={onRepoChange} />

        <span className="breadcrumb-sep">›</span>

        <div className="select-wrap">
          <GitBranch size={14} className="branch-icon" />
          <select
            className="top-select branch-select-top"
            value={branch}
            disabled={repoSwitching || loading || fetching}
            onChange={(event) => onBranchChange(event.currentTarget.value)}
          >
            {/* A detached checkout has no branch, so nothing here matches the
                select's value, and an unmatched <select> displays its first
                option instead: the bar claimed you were on whatever branch
                happened to sort first. State it plainly instead. */}
            {branches.includes(branch) ? null : (
              <option value={branch}>{branch}</option>
            )}
            {branches.map((name) => {
              // A branch checked out in another folder can't be checked out
              // here — git refuses. Saying so in the list turns a failure into
              // a choice: picking it opens that folder instead. The folder's
              // name, not its path: the path is long enough to read as a
              // statement about where you are rather than where you'd go.
              // A folder deleted outside Gitty is still registered, so the
              // branch is still held — but there is nothing to open. Saying
              // "open <name>" would send the user to a folder that is gone.
              const elsewhere = openElsewhere.get(name);
              const label = !elsewhere
                ? name
                : elsewhere.prunable
                  ? `${name}  ·  folder missing`
                  : `${name}  →  open ${folderName(elsewhere.path)}`;
              return (
                <option key={name} value={name}>
                  {label}
                </option>
              );
            })}
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
        {/* "Open in folder" and "Back to now" moved to the timeline's action
            row, alongside "Merge into main". They only exist while a commit is
            selected, and gaining then losing a pair of buttons here made the
            whole top bar reflow on every selection change — and at common
            widths they collided with the Viewing banner and wrapped to two
            lines. The timeline row is where the commit context already lives. */}
        <button
          type="button"
          className="ghost-btn"
          title={fetching ? "Fetching latest remote changes…" : "Refresh local repository status"}
          disabled={loading || fetching || repoSwitching}
          onClick={onRefresh}
        >
          <RefreshCw size={15} className={loading || fetching || repoSwitching ? "spin" : ""} />
        </button>
        {onPull && onPullMerge && !repoSwitching ? (
          <PullButton
            behind={behind}
            ahead={ahead}
            hasUpstream={hasUpstream}
            pullPhase={pullPhase}
            loading={loading || fetching}
            onPull={onPull}
            onPullMerge={onPullMerge}
          />
        ) : null}
        {onPush && onForcePush && onOverwrite && !repoSwitching ? (
          <PushButton
            ahead={ahead}
            behind={behind}
            unpushedTags={unpushedTags}
            hasRemotes={hasRemotes}
            unpublished={branchUnpublished}
            forceSuggested={forceSuggested}
            pushPhase={pushPhase}
            loading={loading || fetching}
            disabled={disabled}
            onPush={onPush}
            onForcePush={onForcePush}
            onOverwrite={onOverwrite}
          />
        ) : null}
        {backupSetupAvailable && onSetupBackup && !repoSwitching ? (
          <BackupButton
            remoteName={backupRemoteName}
            phase={backupPhase}
            loading={loading || fetching}
            onSetup={onSetupBackup}
          />
        ) : null}
        {onUpdateLinkedFolder && !repoSwitching ? (
          <LinkedFolderUpdatesButton
            folders={linkedUpdates}
            busyPrefix={linkedBusyPrefix}
            loading={loading || fetching}
            onUpdate={onUpdateLinkedFolder}
            onOpenSettings={onManageLinkedFolders}
          />
        ) : null}
        {onPublishLinkedFolder && !repoSwitching ? (
          <LinkedFolderPublishButton
            folders={linkedPublishable}
            busyPrefix={linkedPushBusyPrefix}
            loading={loading || fetching}
            onPublish={onPublishLinkedFolder}
            onOpenSettings={onManageLinkedFolders}
          />
        ) : null}
        {!hasRemotes && onSetupRemote ? (
          <button
            type="button"
            className="setup-remote-btn"
            title="Add a remote to push commits"
            disabled={loading || fetching}
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
            disabled={loading || fetching}
            onClick={onOpenRepoSettings}
          >
            <Settings size={15} />
          </button>
        ) : null}
      </div>
    </header>
  );
}
