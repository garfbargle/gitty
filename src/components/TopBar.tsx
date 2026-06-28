import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitCompareArrows,
  GitMerge,
  History,
  Link2,
  PanelLeft,
  PanelLeftClose,
  RefreshCw,
  Settings,
  X,
} from "lucide-react";
import type { BranchEntry, CommitEntry, RepoEntry, VisitSession } from "../types";
import { PushButton, type PushPhase } from "./PushButton";
import { RepoPicker } from "./RepoPicker";
import { WorkingTreePicker } from "./WorkingTreePicker";

type TopBarProps = {
  repos: RepoEntry[];
  selectedPath: string;
  branch: string;
  branches: string[];
  branchEntries?: BranchEntry[];
  commits: CommitEntry[];
  aheadCommits?: CommitEntry[];
  aheadBranch?: string | null;
  changeCount: number;
  viewMode: "working" | "history";
  viewingCommit?: CommitEntry | null;
  visitSession?: VisitSession | null;
  loading?: boolean;
  pushPhase?: PushPhase;
  repoSwitching?: boolean;
  ahead?: number;
  behind?: number;
  unpushedTags?: number;
  hasRemotes?: boolean;
  onRepoChange: (path: string) => void;
  onBranchChange: (branch: string) => void;
  onMergeIn?: (branch: string) => void;
  onToggleView: () => void;
  onReturnToWorkingTree: () => void;
  onSelectCommit: (commit: CommitEntry) => void;
  onVisitCommit?: () => void;
  onReturnFromVisit?: () => void;
  onResumeBranch?: () => void;
  onRefresh: () => void;
  onPush?: () => Promise<boolean>;
  onForcePush?: () => Promise<boolean>;
  onSetupRemote?: () => void;
  onOpenRepoSettings?: () => void;
  sidebarVisible?: boolean;
  onToggleSidebar?: () => void;
  mergeStripAvailable?: boolean;
  mergeIncoming?: boolean;
  mergeSource?: string | null;
  mergeTargetName?: string | null;
  mergePartner?: string | null;
  mergeCandidates?: string[];
  onMergePartnerChange?: (name: string) => void;
  onClearMerge?: () => void;
  mergeActive?: boolean;
  aheadOfBase?: number | null;
  baseBehind?: number | null;
  mergeConflictState?: "clean" | "conflicts" | "unknown" | "checking";
  onOpenMerge?: () => void;
  onExitMerge?: () => void;
};

export function TopBar({
  repos,
  selectedPath,
  branch,
  branches,
  branchEntries,
  commits,
  aheadCommits = [],
  aheadBranch,
  changeCount,
  viewMode,
  viewingCommit,
  visitSession,
  loading,
  pushPhase = "idle",
  repoSwitching = false,
  ahead = 0,
  behind = 0,
  unpushedTags = 0,
  hasRemotes = false,
  onRepoChange,
  onBranchChange,
  onMergeIn,
  onToggleView,
  onReturnToWorkingTree,
  onSelectCommit,
  onVisitCommit,
  onReturnFromVisit,
  onResumeBranch,
  onRefresh,
  onPush,
  onForcePush,
  onSetupRemote,
  onOpenRepoSettings,
  sidebarVisible = true,
  onToggleSidebar,
  mergeStripAvailable = false,
  mergeIncoming = false,
  mergeSource,
  mergeTargetName,
  mergePartner,
  mergeCandidates = [],
  onMergePartnerChange,
  onClearMerge,
  mergeActive = false,
  aheadOfBase,
  baseBehind,
  mergeConflictState = "unknown",
  onOpenMerge,
  onExitMerge,
}: TopBarProps) {
  const inTimeTravel = !!visitSession;
  const inPreview = !!viewingCommit && !inTimeTravel;
  const previewBranchLabel = branch.includes("detached") ? "latest" : branch;
  const timeTravelCommit = visitSession?.visitedCommit;
  const showMergeStrip =
    mergeStripAvailable &&
    !branch.includes("detached") &&
    !inTimeTravel &&
    !inPreview &&
    viewMode === "working";
  // A partner is chosen → we have a real source→target pair to act on.
  const hasPair = !!mergeSource && !!mergeTargetName;
  const upstreamLabel =
    branchEntries?.find((entry) => entry.name === branch && !entry.isRemote)?.upstream ?? null;

  return (
    <header className={`top-bar${inTimeTravel ? " time-travel-mode" : ""}${inPreview ? " preview-mode" : ""}`}>
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

        <RepoPicker repos={repos} selectedPath={selectedPath} onChange={onRepoChange} />

        <span className="breadcrumb-sep">›</span>

        <div className="select-wrap">
          <GitBranch size={14} className="branch-icon" />
          <select
            className="top-select branch-select-top"
            value={branch}
            disabled={repoSwitching || loading || inTimeTravel}
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

        {!branch.includes("detached") && (ahead > 0 || behind > 0) ? (
          <span
            className="branch-divergence"
            title={`${ahead} ahead, ${behind} behind${
              upstreamLabel ? ` vs ${upstreamLabel}` : ""
            }`}
          >
            {ahead > 0 ? <span className="branch-divergence-ahead">↑{ahead}</span> : null}
            {behind > 0 ? <span className="branch-divergence-behind">↓{behind}</span> : null}
          </span>
        ) : null}

        <div className="view-mode-switch" role="tablist" aria-label="View">
          <button
            type="button"
            role="tab"
            className={`view-mode-segment${viewMode === "working" ? " active" : ""}`}
            aria-selected={viewMode === "working"}
            disabled={repoSwitching || inTimeTravel}
            onClick={() => {
              if (viewMode !== "working") onToggleView();
            }}
          >
            <GitCompareArrows size={14} />
            <span>Changes</span>
          </button>
          <button
            type="button"
            role="tab"
            className={`view-mode-segment${viewMode === "history" ? " active" : ""}`}
            aria-selected={viewMode === "history"}
            disabled={repoSwitching || inTimeTravel}
            onClick={() => {
              if (viewMode !== "history") onToggleView();
            }}
          >
            <History size={14} />
            <span>History</span>
          </button>
        </div>

        {inTimeTravel && timeTravelCommit ? (
          <>
            <span className="breadcrumb-sep">›</span>
            <div className="time-travel-banner" role="status">
              <span className="time-travel-label">Time Travel</span>
              <code>{timeTravelCommit.shortHash}</code>
            </div>
          </>
        ) : inPreview && viewingCommit ? (
          <>
            <span className="breadcrumb-sep">›</span>
            <div className="preview-banner" role="status">
              <span className="preview-label">Viewing</span>
              <code>{viewingCommit.shortHash}</code>
              <span className="preview-meta">· workspace on {previewBranchLabel}</span>
            </div>
          </>
        ) : viewMode === "working" ? (
          <>
            {showMergeStrip ? (
              <>
                <ChevronRight size={14} className="merge-strip-arrow" />
                <div
                  className={`merge-strip${mergeActive ? " active" : ""}${
                    hasPair ? "" : " compact"
                  }`}
                >
                  <GitMerge size={13} className="merge-strip-icon" />
                  {(() => {
                    // The partner branch is the editable side; the current
                    // branch is fixed. On the trunk the partner is the source
                    // (merged in); elsewhere it's the target (shipped to).
                    const PartnerPicker = (
                      <span className="merge-strip-select-wrap">
                        <select
                          className="merge-strip-select"
                          value={mergePartner ?? ""}
                          title="Choose a branch to merge"
                          disabled={mergeActive || !onMergePartnerChange}
                          onChange={(event) =>
                            onMergePartnerChange?.(event.currentTarget.value)
                          }
                        >
                          {!mergePartner ? (
                            <option value="" disabled>
                              Merge…
                            </option>
                          ) : null}
                          {mergeCandidates.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={11} className="merge-strip-chevron" />
                      </span>
                    );

                    if (!hasPair) return PartnerPicker;

                    // The current branch is already shown in the branch picker,
                    // so only render the partner side plus a direction arrow.
                    // Incoming (on the trunk): partner → current. Ship: → partner.
                    return mergeIncoming ? (
                      <>
                        {PartnerPicker}
                        <ChevronRight size={12} className="merge-strip-into" />
                        <span className="merge-strip-base">{mergeTargetName}</span>
                      </>
                    ) : (
                      <>
                        <ChevronRight size={12} className="merge-strip-into" />
                        {PartnerPicker}
                      </>
                    );
                  })()}

                  {hasPair ? (
                    mergeConflictState === "checking" ? (
                      <span className="merge-chip neutral">checking…</span>
                    ) : (
                      <>
                        {typeof aheadOfBase === "number" && aheadOfBase > 0 ? (
                          <span className="merge-chip ahead">{aheadOfBase} ahead</span>
                        ) : null}
                        {typeof baseBehind === "number" && baseBehind > 0 ? (
                          <span className="merge-chip behind">{baseBehind} behind</span>
                        ) : null}
                        {mergeConflictState === "clean" ? (
                          <span className="merge-chip ok">no conflicts</span>
                        ) : mergeConflictState === "conflicts" ? (
                          <span className="merge-chip danger">conflicts</span>
                        ) : null}
                      </>
                    )
                  ) : null}
                  {hasPair && !mergeActive && onClearMerge ? (
                    <button
                      type="button"
                      className="merge-strip-clear"
                      title="Clear merge selection"
                      aria-label="Clear merge selection"
                      onClick={onClearMerge}
                    >
                      <X size={12} />
                    </button>
                  ) : null}
                </div>
              </>
            ) : null}
            <span className="breadcrumb-sep">›</span>
            <WorkingTreePicker
              commits={commits}
              aheadCommits={aheadCommits}
              aheadBranch={aheadBranch}
              branch={branch}
              branchEntries={branchEntries}
              viewingCommit={viewingCommit}
              changeCount={changeCount}
              onSelectWorkingTree={onReturnToWorkingTree}
              onSelectCommit={onSelectCommit}
              onResumeBranch={onResumeBranch}
              onCheckoutBranch={onBranchChange}
              onMergeBranch={onMergeIn}
            />
          </>
        ) : null}
      </div>

      <div className="top-bar-right">
        {inTimeTravel && onReturnFromVisit ? (
          <button
            type="button"
            className="return-to-latest-btn"
            title="Return to your latest branch and restore stashed changes if any"
            disabled={loading}
            onClick={onReturnFromVisit}
          >
            Return to Latest
          </button>
        ) : null}
        {!inTimeTravel && aheadCommits.length > 0 && aheadBranch && onResumeBranch ? (
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
        {inPreview && onVisitCommit ? (
          <button
            type="button"
            className="visit-commit-btn"
            title="Check out this commit on disk (detached HEAD)"
            disabled={loading}
            onClick={onVisitCommit}
          >
            Visit Commit
          </button>
        ) : null}
        {inPreview ? (
          <button
            type="button"
            className="return-to-changes-btn"
            title="Return to current working tree"
            onClick={onReturnToWorkingTree}
          >
            <span className="working-dot" />
            Back to Working Tree
            {changeCount > 0 ? <em>{changeCount}</em> : null}
          </button>
        ) : null}
        {showMergeStrip && onOpenMerge ? (
          mergeActive ? (
            <button
              type="button"
              className={`merge-action-btn${mergeConflictState === "conflicts" ? " danger" : " active"}`}
              title="Close merge mode"
              onClick={onExitMerge}
            >
              <GitMerge size={14} />
              {mergeConflictState === "conflicts" ? "Resolving" : "Merging"}
            </button>
          ) : hasPair ? (
            <button
              type="button"
              className="merge-action-btn"
              title={`Merge ${mergeSource} into ${mergeTargetName}`}
              disabled={loading}
              onClick={onOpenMerge}
            >
              <GitMerge size={14} />
              Merge
            </button>
          ) : null
        ) : null}
        <button type="button" className="ghost-btn" title="Refresh" disabled={loading || repoSwitching} onClick={onRefresh}>
          <RefreshCw size={15} className={loading || repoSwitching ? "spin" : ""} />
        </button>
        {onPush && onForcePush && !repoSwitching && !inTimeTravel ? (
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
