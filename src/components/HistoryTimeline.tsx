import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, GitBranch } from "lucide-react";
import type { BranchDivergence, CommitEntry } from "../types";
import { aheadTimelineCommits, ancestryTimelineCommits } from "../lib/commitDisplay";
import { buildCommitTagMenuItems } from "../lib/commitTags";
import { laneColor } from "../lib/graph";
import { formatDate, formatRelativeTime, relativeTimeRefreshMs, tagName, tagRefs } from "../lib/git";
import { ContextMenu } from "./ContextMenu";
import { TagBadge } from "./TagBadge";

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
  workingTreeActive?: boolean;
  /// Where the checked-out branch sits relative to the trunk and its upstream.
  contextLanes?: BranchDivergence[];
  /// Pull the given reference branch into the current branch ("update").
  onUpdateFromBase?: (lane: BranchDivergence) => void;
  mergePreview?: {
    source: string;
    target: string;
    merged: boolean;
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
  workingTreeActive,
  contextLanes = [],
  onUpdateFromBase,
  mergePreview,
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
  }, [measureLanes, headHash, ancestry.length, ahead.length, changeCount, !!mergePreview]);

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
        onVisitCommit,
        onCreateTag: tagActionsEnabled ? onCreateTag : undefined,
        onDeleteTag: tagActionsEnabled ? onDeleteTag : undefined,
      }),
    });
  }

  function renderCommitNode(
    commit: CommitEntry,
    index: number,
    showConnector: boolean,
    isAhead: boolean,
  ) {
    const color = laneColor(index % 6);
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
        {showConnector ? <span className="node-connector" style={{ background: color }} /> : null}
      </button>
    );
  }

  const hasMoreAfterAncestry = changeCount > 0 || ahead.length > 0;

  // Pin the working-tree node to the right edge while history scrolls under it,
  // but only when it's the last node on the track — once you have ahead commits
  // or a merge preview sitting to its right, it's no longer "the present" and a
  // sticky overlay would cover them.
  const pinWorkingTree = ahead.length === 0 && !mergePreview;

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
    const overflow = lane.behind - visible;
    // j = 0 is the reference tip (newest), pinned above the working tree.
    const dotX = (j: number) => rightX - GHOST_SPACING * j;
    const oldestX = dotX(visible - 1);
    const overflowX = dotX(visible);
    const forkX = geom.forks[index];
    const ghost = "var(--text-secondary)";

    return (
      <div className="context-lane" key={`${lane.kind}-${lane.refName}`}>
        <span className="lane-tag" style={{ left: oldestX, top: dotY }}>
          <GitBranch size={10} aria-hidden />
          {lane.refName}
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
        {overflow > 0 ? (
          <span className="lane-overflow" style={{ left: overflowX, top: dotY }}>
            +{overflow}
          </span>
        ) : null}
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

  function renderContextChips() {
    if (contextLanes.length === 0) return null;
    return (
      <div className="timeline-context-bar">
        {contextLanes.map((lane) => {
          const inSync = lane.behind === 0 && lane.ahead === 0;
          return (
            <div
              className={`context-chip${lane.behind > 0 ? " behind" : ""}`}
              key={`chip-${lane.kind}-${lane.refName}`}
            >
              <GitBranch size={12} aria-hidden />
              <span className="chip-ref">{lane.refName}</span>
              {inSync ? (
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
              {lane.behind > 0 && onUpdateFromBase ? (
                <button
                  type="button"
                  className="chip-update"
                  onClick={() => onUpdateFromBase(lane)}
                  title={`Bring ${lane.refName} into your branch`}
                >
                  Update
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="history-timeline">
      {renderContextChips()}
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
          {ancestry.map((commit, index) =>
            renderCommitNode(
              commit,
              index,
              index < ancestry.length - 1 || hasMoreAfterAncestry,
              false,
            ),
          )}

          <button
            className={`timeline-node working-tree ${workingTreeActive ? "active" : ""} ${pinWorkingTree ? "pinned" : ""} ${changeCount > 0 ? "has-changes" : ""}`}
            type="button"
            ref={(node) => {
              if (node) nodeRefs.current.set("working-tree", node);
              else nodeRefs.current.delete("working-tree");
            }}
            onClick={selectWorkingTree}
          >
            <span className="node-dot working" />
            <span className="node-hash">Working Tree</span>
            <span className="node-subject">{changeCount} change{changeCount === 1 ? "" : "s"}</span>
            {ahead.length > 0 ? <span className="node-connector ahead-bridge" /> : null}
          </button>

          {ahead.map((commit, index) =>
            renderCommitNode(
              commit,
              ancestry.length + index,
              index < ahead.length - 1 || !!mergePreview,
              true,
            ),
          )}

          {mergePreview ? (
            <div
              className={`timeline-node merge-preview${
                mergePreview.merged ? " merged" : ""
              }${mergePreview.conflicts ? " conflicts" : ""}`}
              title={
                mergePreview.merged
                  ? `Merged ${mergePreview.source} into ${mergePreview.target}`
                  : mergePreview.conflicts
                    ? `Merge ${mergePreview.source} into ${mergePreview.target} — conflicts`
                    : `Preview: merge ${mergePreview.source} into ${mergePreview.target}`
              }
            >
              <span className="node-dot merge-preview-dot" />
              <span className="node-hash">{mergePreview.target}</span>
              <span className="node-subject">
                {mergePreview.merged
                  ? "merged"
                  : mergePreview.conflicts
                    ? "conflicts"
                    : "merge preview"}
              </span>
            </div>
          ) : null}
          </div>
        </div>
      </div>

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
