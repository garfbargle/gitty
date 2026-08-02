import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FolderOpen, GitBranch } from "lucide-react";
import type { BranchDivergence, CommitEntry, SiblingTip, WorktreeEntry } from "../types";
import { aheadTimelineCommits, ancestryTimelineCommits } from "../lib/commitDisplay";
import { buildCommitTagMenuItems } from "../lib/commitTags";
import {
  formatDate,
  formatRelativeTime,
  relativeTimeRefreshMs,
  remoteFreshness,
  tagName,
  tagRefs,
} from "../lib/git";
import { ContextMenu } from "./ContextMenu";
import { TagBadge } from "./TagBadge";

/// A checkout's folder name. Paths are too long for a chip and the name is
/// what tells one checkout from another.
function folderName(path: string) {
  return path.split("/").filter(Boolean).pop() ?? path;
}

const SCROLL_END_THRESHOLD = 24;
const SCROLLBAR_HIDE_DELAY_MS = 800;

// Branch-context lane geometry. Ghost commits cluster near the right edge (most
// recent) above the working tree, so "the base has moved ahead of you" stays
// visible even when the timeline is scrolled to the present. The lanes live in
// their own region that occupies real layout space above the commit track, so a
// lane can never overlap the commit row. LANE_BOTTOM_PAD is the clear air between
// the lowest lane and that row.
const GHOST_SPACING = 28;
const MAX_GHOST_DOTS = 8;
const LANE_BAND_H = 30;
const LANE_TOP_PAD = 12;
const LANE_BOTTOM_PAD = 12;

type HistoryTimelineProps = {
  commits: CommitEntry[];
  aheadCommits?: CommitEntry[];
  changeCount: number;
  unpushedTags?: Set<string>;
  selectedHash?: string;
  onSelect: (commit: CommitEntry) => void;
  onSelectWorkingTree: () => void;
  onVisitCommit?: (commit: CommitEntry) => void;
  onInteract?: () => void;
  onCreateTag?: (commit: CommitEntry) => void;
  onDeleteTag?: (commit: CommitEntry, name: string) => void;
  onBranchFrom?: (commit: CommitEntry) => void;
  onResetTo?: (commit: CommitEntry) => void;
  workingTreeActive?: boolean;
  /// Where the checked-out branch sits relative to the trunk and its upstream.
  contextLanes?: BranchDivergence[];
  /// The most recently active other branch, shown as a single awareness chip.
  siblingTip?: SiblingTip | null;
  /// Switch to the sibling branch.
  onSwitchSibling?: (name: string) => void;
  /// The two moves against the trunk: rebase your branch onto it, or merge in.
  canUpdateFromMain?: boolean;
  canMergeIntoMain?: boolean;
  integrationBusy?: boolean;
  onUpdateFromMain?: () => void;
  onMergeIntoMain?: () => void;
  /// Pull the branch's upstream (the "origin/… ↓N" lane) — the same action as
  /// the toolbar Pull button, offered where the user is looking at the gap.
  onPullUpstream?: () => void;
  pullBusy?: boolean;
  /// Which density of history is showing. The switch lives in this component
  /// because it heads the context row that both densities sit under.
  /// When the remote was last actually reached. Only the remote chip is
  /// affected: a trunk branch is local, so it is never stale.
  lastFetchedAt?: number | null;
  /// The branch checked out in this folder, so the row can say where you are.
  currentBranch?: string;
  /// Other checkouts of this repository. Nothing else on this screen mentions
  /// them, so without these the row cannot answer "is this the only folder".
  worktrees?: WorktreeEntry[];
  onOpenCheckout?: (path: string) => void;
  historyView?: "strip" | "graph";
  onHistoryViewChange?: (view: "strip" | "graph") => void;
  /// Viewing a past commit rather than the working tree. The actions for
  /// leaving that state live here rather than in the top bar: they only exist
  /// while a commit is selected, and the top bar has no spare room to gain and
  /// lose a pair of buttons every time the selection changes.
  inPreview?: boolean;
  onOpenVersion?: () => void;
  onReturnToWorkingTree?: () => void;
  /// A live integration op, drawn as a preview node on the track.
  integrationPreview?: {
    kind: "update" | "merge";
    branch: string;
    onto: string;
    done: boolean;
    conflicts: boolean;
  } | null;
};

export function HistoryTimeline({
  commits,
  aheadCommits = [],
  changeCount,
  unpushedTags,
  selectedHash,
  onSelect,
  onSelectWorkingTree,
  onVisitCommit,
  onInteract,
  onCreateTag,
  onDeleteTag,
  onBranchFrom,
  onResetTo,
  workingTreeActive,
  contextLanes = [],
  siblingTip,
  onSwitchSibling,
  canUpdateFromMain,
  canMergeIntoMain,
  integrationBusy,
  onUpdateFromMain,
  onMergeIntoMain,
  onPullUpstream,
  pullBusy,
  lastFetchedAt,
  currentBranch,
  worktrees = [],
  onOpenCheckout,
  historyView = "strip",
  onHistoryViewChange,
  inPreview,
  onOpenVersion,
  onReturnToWorkingTree,
  integrationPreview,
}: HistoryTimelineProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ReturnType<typeof buildCommitTagMenuItems>;
  } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const tagActionsEnabled = !!(onCreateTag && onDeleteTag);
  const ancestry = useMemo(() => ancestryTimelineCommits(commits), [commits]);
  const ahead = useMemo(() => aheadTimelineCommits(aheadCommits), [aheadCommits]);
  const commitDates = useMemo(
    () => [...ancestry, ...ahead].map((commit) => commit.date),
    [ancestry, ahead],
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timeoutId: number | null = null;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const currentNow = Date.now();
      setNow(currentNow);
      const next = relativeTimeRefreshMs(commitDates, currentNow);
      if (next !== null) {
        timeoutId = window.setTimeout(tick, next);
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [commitDates]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const pinnedToEndRef = useRef(true);
  const programmaticScrollDepthRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollbarTimeoutRef = useRef<number | null>(null);
  const headHash = commits[0]?.hash ?? "";

  // Only lanes that are actually behind get drawn — a base you're level with or
  // ahead of needs no ghost commits, just a header chip.
  const lanes = useMemo(
    () => contextLanes.filter((lane) => lane.behind > 0 && lane.commits.length > 0),
    [contextLanes],
  );
  const laneRegionHeight =
    lanes.length > 0 ? LANE_TOP_PAD + lanes.length * LANE_BAND_H + LANE_BOTTOM_PAD : 0;

  // Fork x (merge-base node centre) per lane, plus the right anchor (working-tree
  // node centre) the ghost commits hang above — all in wrap-content coordinates,
  // so they survive horizontal scrolling without re-measuring.
  const [geom, setGeom] = useState<{ rightX: number | null; forks: (number | null)[] }>({
    rightX: null,
    forks: [],
  });

  const measureLanes = useCallback(() => {
    if (lanes.length === 0) {
      setGeom((prev) => (prev.rightX === null && prev.forks.length === 0 ? prev : { rightX: null, forks: [] }));
      return;
    }
    const centerOf = (node: HTMLButtonElement | undefined) =>
      node ? node.offsetLeft + node.offsetWidth / 2 : null;
    const wt = nodeRefs.current.get("working-tree");
    const rightX = centerOf(wt);
    const forks = lanes.map((lane) =>
      lane.mergeBase ? centerOf(nodeRefs.current.get(lane.mergeBase)) : null,
    );
    setGeom((prev) => {
      const same =
        prev.rightX === rightX &&
        prev.forks.length === forks.length &&
        prev.forks.every((value, index) => value === forks[index]);
      return same ? prev : { rightX, forks };
    });
  }, [lanes]);

  const revealScrollbar = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    container.classList.add("is-scrolling");
    if (scrollbarTimeoutRef.current !== null) {
      window.clearTimeout(scrollbarTimeoutRef.current);
    }
    scrollbarTimeoutRef.current = window.setTimeout(() => {
      container.classList.remove("is-scrolling");
      scrollbarTimeoutRef.current = null;
    }, SCROLLBAR_HIDE_DELAY_MS);
  }, []);

  const withProgrammaticScroll = useCallback((update: () => void) => {
    programmaticScrollDepthRef.current += 1;
    update();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        programmaticScrollDepthRef.current -= 1;
      });
    });
  }, []);

  const isScrolledToEnd = useCallback((): boolean => {
    const container = scrollRef.current;
    if (!container) return true;
    const remaining = container.scrollWidth - container.clientWidth - container.scrollLeft;
    return remaining <= SCROLL_END_THRESHOLD;
  }, []);

  const scrollNodeIntoView = useCallback((node: HTMLButtonElement | undefined) => {
    const container = scrollRef.current;
    if (!container || !node) return;

    const padding = 16;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();

    if (nodeRect.left < containerRect.left + padding) {
      container.scrollLeft -= containerRect.left + padding - nodeRect.left;
    } else if (nodeRect.right > containerRect.right - padding) {
      container.scrollLeft += nodeRect.right - (containerRect.right - padding);
    }
  }, []);

  const applyScrollPosition = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    withProgrammaticScroll(() => {
      if (workingTreeActive || pinnedToEndRef.current) {
        pinnedToEndRef.current = true;
        container.scrollLeft = container.scrollWidth - container.clientWidth;
        return;
      }

      if (!selectedHash) return;

      pinnedToEndRef.current = false;
      scrollNodeIntoView(nodeRefs.current.get(selectedHash));
    });
  }, [selectedHash, scrollNodeIntoView, withProgrammaticScroll, workingTreeActive]);

  const scheduleApplyScrollPosition = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
    }
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      applyScrollPosition();
    });
  }, [applyScrollPosition]);

  const handleScroll = useCallback(() => {
    pinnedToEndRef.current = isScrolledToEnd();
    if (programmaticScrollDepthRef.current > 0) return;
    revealScrollbar();
  }, [isScrolledToEnd, revealScrollbar]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        revealScrollbar();
        return;
      }
      event.preventDefault();
      container.scrollLeft += event.deltaY;
      revealScrollbar();
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", onWheel);
      if (scrollbarTimeoutRef.current !== null) {
        window.clearTimeout(scrollbarTimeoutRef.current);
      }
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, [revealScrollbar]);

  useLayoutEffect(() => {
    scheduleApplyScrollPosition();
  }, [headHash, selectedHash, workingTreeActive, ancestry.length, ahead.length, scheduleApplyScrollPosition]);

  useLayoutEffect(() => {
    measureLanes();
  }, [measureLanes, headHash, ancestry.length, ahead.length, changeCount, !!integrationPreview]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    const track = container?.querySelector(".timeline-track");
    if (!container) return;

    const observer = new ResizeObserver(() => {
      scheduleApplyScrollPosition();
      measureLanes();
    });

    observer.observe(container);
    if (track) observer.observe(track);

    return () => observer.disconnect();
  }, [scheduleApplyScrollPosition, measureLanes]);

  function selectCommit(commit: CommitEntry) {
    onInteract?.();
    onSelect(commit);
  }

  function selectWorkingTree() {
    onInteract?.();
    onSelectWorkingTree();
  }

  function openTagContextMenu(event: React.MouseEvent, commit: CommitEntry) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: buildCommitTagMenuItems(commit, {
        onBranchFrom,
        onResetTo,
        onVisitCommit,
        onCreateTag: tagActionsEnabled ? onCreateTag : undefined,
        onDeleteTag: tagActionsEnabled ? onDeleteTag : undefined,
      }),
    });
  }

  function renderCommitNode(
    commit: CommitEntry,
    isAhead: boolean,
  ) {
    // The strip draws exactly one branch, so there is no branch identity for
    // colour to carry here and it stays free for state. (`laneColor` still does
    // identity work in GraphView, where several branches share the screen.)
    // Previously this was `laneColor(index % 6)` — the commit's position in the
    // array, so colour varied per commit while encoding nothing.
    const color = isAhead ? "var(--accent)" : "var(--border-strong)";
    const active = commit.hash === selectedHash && !workingTreeActive;
    const tags = tagRefs(commit.refs).map(tagName);
    const tagSummary = tags.length > 0 ? ` · ${tags.join(", ")}` : "";
    return (
      <button
        className={`timeline-node ${active ? "active" : ""} ${isAhead ? "ahead" : ""}`}
        key={`${isAhead ? "ahead" : "ancestry"}-${commit.hash}`}
        type="button"
        ref={(node) => {
          if (node) nodeRefs.current.set(commit.hash, node);
          else nodeRefs.current.delete(commit.hash);
        }}
        onClick={() => selectCommit(commit)}
        onContextMenu={(event) => openTagContextMenu(event, commit)}
        title={`${commit.shortHash} · ${commit.subject} · ${formatDate(commit.date)}${tagSummary}${isAhead ? " · ahead on branch" : ""}`}
      >
        <span
          className="node-dot"
          style={{
            background: isAhead ? "transparent" : color,
            boxShadow: isAhead ? undefined : `0 0 12px ${color}55`,
            outline: isAhead ? `2px dashed ${color}` : undefined,
            outlineOffset: isAhead ? 1 : undefined,
          }}
        />
        <span className="node-hash">{commit.shortHash}</span>
        <span className="node-time">{formatRelativeTime(commit.date, now)}</span>
        <span className="node-subject">{commit.subject}</span>
        {tags.length > 0 ? (
          <span className="node-tags">
            {tags.map((name) => (
              <TagBadge key={name} name={name} unpushed={unpushedTags?.has(name)} muted />
            ))}
          </span>
        ) : null}
        {isAhead ? <span className="node-ahead-label">ahead</span> : null}
      </button>
    );
  }

  // Pin the working-tree node to the right edge while history scrolls under it,
  // but only when it's the last node on the track — once you have ahead commits
  // or a merge preview sitting to its right, it's no longer "the present" and a
  // sticky overlay would cover them.
  const pinWorkingTree = ahead.length === 0 && !integrationPreview;

  // One ghost lane, drawn inside the dedicated lane region that sits *above* the
  // commit track in normal flow (so it can never overlap the commits). The
  // reference's recent commits cluster above the working tree (the present), with
  // a faint strand and a downward stub back to where you forked.
  function renderLane(lane: BranchDivergence, index: number) {
    const rightX = geom.rightX;
    if (rightX === null) return null;

    const bandTop = LANE_TOP_PAD + index * LANE_BAND_H;
    const dotY = bandTop + Math.round(LANE_BAND_H / 2);
    const visible = Math.min(lane.behind, MAX_GHOST_DOTS);
    // j = 0 is the reference tip (newest), pinned above the working tree.
    const dotX = (j: number) => rightX - GHOST_SPACING * j;
    const oldestX = dotX(visible - 1);
    const forkX = geom.forks[index];
    const ghost = "var(--text-secondary)";

    return (
      <div className="context-lane" key={`${lane.kind}-${lane.refName}`}>
        {/* The count used to be a separate element positioned one step further
            left, which collided with this tag whenever a lane was more than
            MAX_GHOST_DOTS behind and covered the branch name. One label. */}
        <span className="lane-tag" style={{ left: oldestX, top: dotY }}>
          <span className="chip-kind">Not here</span>
          <GitBranch size={10} aria-hidden />
          <span className="chip-ref">{lane.refName}</span>
          <span className="lane-count">{lane.behind}</span>
        </span>
        {forkX !== null && forkX < oldestX - 2 ? (
          <span
            className="lane-strand faded"
            style={{ left: forkX, width: oldestX - forkX, top: dotY }}
          />
        ) : null}
        {forkX !== null ? (
          <span
            className="lane-fork-stub"
            style={{ left: forkX, top: dotY, height: laneRegionHeight - dotY }}
          />
        ) : null}
        <span
          className="lane-strand"
          style={{ left: oldestX, width: Math.max(rightX - oldestX, 0), top: dotY, background: ghost }}
        />
        {lane.commits.slice(0, visible).map((commit, j) => (
          <span
            key={commit.hash}
            className={`lane-dot${j === 0 ? " tip" : ""}`}
            style={{ left: dotX(j), top: dotY, borderColor: ghost }}
            title={`${lane.refName} · ${commit.shortHash} · ${commit.subject}`}
          />
        ))}
      </div>
    );
  }

  function renderSiblingChip() {
    if (!siblingTip) return null;
    return (
      <button
        type="button"
        className="context-chip sibling"
        title={`${siblingTip.name} · ${siblingTip.tip.subject}`}
        onClick={() => onSwitchSibling?.(siblingTip.name)}
        disabled={!onSwitchSibling}
      >
        <span className="chip-kind">Branch</span>
        <GitBranch size={12} aria-hidden />
        <span className="chip-ref">{siblingTip.name}</span>
        {siblingTip.ahead > 0 ? (
          <span className="chip-count ahead">
            <ArrowUp size={11} aria-hidden />
            {siblingTip.ahead}
          </span>
        ) : null}
      </button>
    );
  }

  const showPreviewActions = !!inPreview && !!onReturnToWorkingTree;

  const otherCheckouts = worktrees.filter((entry) => !entry.isCurrent && !entry.internal);

  const showActions =
    (canUpdateFromMain && !!onUpdateFromMain) ||
    (canMergeIntoMain && !!onMergeIntoMain) ||
    showPreviewActions;

  function renderContextChips() {
    if (contextLanes.length === 0 && !siblingTip && !showActions) return null;
    return (
      <div className="timeline-context-bar">
        {/* Owns the history region below it, so it heads the row that region
            already has rather than adding one. A segmented control because this
            is a view switch over one thing, not two separate actions. */}
        {onHistoryViewChange ? (
          <div className="view-switch" role="group" aria-label="History view">
            <button
              type="button"
              className={historyView === "strip" ? "active" : ""}
              aria-pressed={historyView === "strip"}
              onClick={() => onHistoryViewChange("strip")}
            >
              Timeline
            </button>
            <button
              type="button"
              className={historyView === "graph" ? "active" : ""}
              aria-pressed={historyView === "graph"}
              onClick={() => onHistoryViewChange("graph")}
            >
              Branches
            </button>
          </div>
        ) : null}
        {/* Where you are. The row used to open with whichever other branch
            happened to be interesting, so nothing said which line was yours. */}
        {currentBranch ? (
          <div
            className="context-chip here"
            title={`${currentBranch} is checked out in this folder`}
          >
            <span className="chip-kind">Here</span>
            <GitBranch size={12} aria-hidden />
            <span className="chip-ref">{currentBranch}</span>
          </div>
        ) : null}
        {renderSiblingChip()}
        {contextLanes.map((lane) => {
          const inSync = lane.behind === 0 && lane.ahead === 0;
          // A trunk lane is a local branch and cannot go stale; only what we
          // learned from the network can.
          const freshness =
            lane.kind === "upstream" ? remoteFreshness(lastFetchedAt, now) : { state: "fresh" as const };
          // The upstream lane, when behind, doubles as a Pull affordance: click
          // the "origin/… ↓N" chip to catch up, right where the gap is shown.
          const pullable = lane.kind === "upstream" && lane.behind > 0 && !!onPullUpstream;
          const chipBody = (
            <>
              <span className="chip-kind">
                {lane.kind === "upstream" ? "Remote" : "Base"}
              </span>
              <GitBranch size={12} aria-hidden />
              <span className="chip-ref">{lane.refName}</span>
              {freshness.state === "unknown" ? (
                // Never reached, so "in sync" would be a guess presented as a
                // fact. Say what is actually known.
                <span className="chip-sync unknown">not checked</span>
              ) : inSync ? (
                <span className="chip-sync">in sync</span>
              ) : (
                <>
                  {lane.behind > 0 ? (
                    <span className="chip-count behind">
                      <ArrowDown size={11} aria-hidden />
                      {lane.behind}
                    </span>
                  ) : null}
                  {lane.ahead > 0 ? (
                    <span className="chip-count ahead">
                      <ArrowUp size={11} aria-hidden />
                      {lane.ahead}
                    </span>
                  ) : null}
                </>
              )}
              {freshness.state === "stale" ? (
                <span className="chip-age" title="Time since the remote was last reached">
                  {freshness.age}
                </span>
              ) : null}
            </>
          );
          return pullable ? (
            <button
              type="button"
              className={`context-chip behind pullable${pullBusy ? " busy" : ""}`}
              key={`chip-${lane.kind}-${lane.refName}`}
              title={`Pull ${lane.behind} commit${lane.behind === 1 ? "" : "s"} from ${lane.refName}`}
              disabled={pullBusy}
              onClick={onPullUpstream}
            >
              {chipBody}
            </button>
          ) : (
            <div
              className={`context-chip${lane.behind > 0 ? " behind" : ""}`}
              key={`chip-${lane.kind}-${lane.refName}`}
            >
              {chipBody}
            </div>
          );
        })}
        {/* Other folders of this repository.

            One chip, not one per folder. A repository with a couple of
            checkouts and one running twenty agent worktrees are both normal,
            and enumerating them turned the row into seven wrapped lines that
            buried the timeline. The count answers "how many folders" at a
            glance; the list is one click away. */}
        {otherCheckouts.length > 0 ? (
          otherCheckouts.length === 1 ? (
            <button
              type="button"
              className="context-chip elsewhere"
              title={`${otherCheckouts[0].branch ?? "detached"} is checked out in ${otherCheckouts[0].path}`}
              onClick={() => onOpenCheckout?.(otherCheckouts[0].path)}
              disabled={!onOpenCheckout}
            >
              <span className="chip-kind">Folder</span>
              <FolderOpen size={12} aria-hidden />
              <span className="chip-ref">{folderName(otherCheckouts[0].path)}</span>
              {otherCheckouts[0].branch ? (
                <span className="chip-sync">{otherCheckouts[0].branch}</span>
              ) : null}
            </button>
          ) : (
            <button
              type="button"
              className="context-chip elsewhere"
              title="Other folders this repository is checked out in"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setContextMenu({
                  x: rect.left,
                  y: rect.bottom + 4,
                  items: otherCheckouts.map((entry) => ({
                    label: `${folderName(entry.path)}  ·  ${entry.branch ?? "detached"}`,
                    onClick: () => onOpenCheckout?.(entry.path),
                  })),
                });
              }}
              disabled={!onOpenCheckout}
            >
              <span className="chip-kind">Folders</span>
              <FolderOpen size={12} aria-hidden />
              <span className="chip-ref">{otherCheckouts.length}</span>
            </button>
          )
        ) : null}
        {showActions ? (
          <div className="timeline-actions">
            {canUpdateFromMain && onUpdateFromMain ? (
              <button
                type="button"
                className="timeline-action update"
                disabled={integrationBusy}
                onClick={onUpdateFromMain}
              >
                <ArrowDown size={13} aria-hidden />
                Update from main
              </button>
            ) : null}
            {canMergeIntoMain && onMergeIntoMain ? (
              <button
                type="button"
                className="timeline-action merge"
                disabled={integrationBusy}
                onClick={onMergeIntoMain}
              >
                <ArrowUp size={13} aria-hidden />
                Merge into main
              </button>
            ) : null}
            {showPreviewActions && onOpenVersion ? (
              <button
                type="button"
                className="timeline-action"
                title="Open this version's files in a folder"
                onClick={onOpenVersion}
              >
                <FolderOpen size={13} aria-hidden />
                Open in folder
              </button>
            ) : null}
            {showPreviewActions ? (
              <button
                type="button"
                className="timeline-action return-to-now"
                title="Back to your current work"
                onClick={onReturnToWorkingTree}
              >
                <span className="working-dot" />
                Back to now
                {changeCount > 0 ? <em>{changeCount}</em> : null}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="history-timeline">
      {renderContextChips()}
      {/* The graph shows the same history at higher density, so showing both
          would say everything twice. The context row above stays in place. */}
      {historyView === "graph" ? null : (
      <div className="timeline-scroller" onScroll={handleScroll} ref={scrollRef}>
        <div className="timeline-track-wrap" ref={wrapRef}>
          {lanes.length > 0 ? (
            <div
              className="timeline-context-lanes"
              style={{ height: laneRegionHeight }}
              aria-hidden
            >
              {lanes.map((lane, index) => renderLane(lane, index))}
            </div>
          ) : null}
          <div className="timeline-track">
          {ancestry.map((commit) => renderCommitNode(commit, false))}

          <button
            className={`timeline-node working-tree ${workingTreeActive ? "active" : ""} ${pinWorkingTree ? "pinned" : ""} ${changeCount > 0 ? "has-changes" : ""} ${ahead.length > 0 ? "ahead-bridge" : ""}`}
            type="button"
            ref={(node) => {
              if (node) nodeRefs.current.set("working-tree", node);
              else nodeRefs.current.delete("working-tree");
            }}
            onClick={selectWorkingTree}
          >
            <span className="node-dot working" />
            <span className="node-hash">Now</span>
            <span className="node-subject">
              {changeCount === 0
                ? "no changes"
                : `${changeCount} unsaved change${changeCount === 1 ? "" : "s"}`}
            </span>
          </button>

          {ahead.map((commit) => renderCommitNode(commit, true))}

          {integrationPreview ? (
            <div
              className={`timeline-node merge-preview${
                integrationPreview.done ? " merged" : ""
              }${integrationPreview.conflicts ? " conflicts" : ""}`}
              title={
                integrationPreview.kind === "merge"
                  ? integrationPreview.done
                    ? `Merged ${integrationPreview.branch} into ${integrationPreview.onto}`
                    : integrationPreview.conflicts
                      ? `Merge ${integrationPreview.branch} into ${integrationPreview.onto} — conflicts`
                      : `Merging ${integrationPreview.branch} into ${integrationPreview.onto}`
                  : integrationPreview.conflicts
                    ? `Update ${integrationPreview.branch} from ${integrationPreview.onto} — conflicts`
                    : `Updating ${integrationPreview.branch} from ${integrationPreview.onto}`
              }
            >
              <span className="node-dot merge-preview-dot" />
              <span className="node-hash">{integrationPreview.onto}</span>
              <span className="node-subject">
                {integrationPreview.done
                  ? "merged"
                  : integrationPreview.conflicts
                    ? "conflicts"
                    : integrationPreview.kind === "merge"
                      ? "merging"
                      : "updating"}
              </span>
            </div>
          ) : null}
          </div>
        </div>
      </div>
      )}

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={closeContextMenu}
        />
      ) : null}
    </div>
  );
}
