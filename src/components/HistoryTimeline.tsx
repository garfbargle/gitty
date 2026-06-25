import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CommitEntry } from "../types";
import { aheadTimelineCommits, ancestryTimelineCommits } from "../lib/commitDisplay";
import { buildCommitTagMenuItems } from "../lib/commitTags";
import { laneColor } from "../lib/graph";
import { formatDate, formatRelativeTime, relativeTimeRefreshMs, tagName, tagRefs } from "../lib/git";
import { ContextMenu } from "./ContextMenu";
import { TagBadge } from "./TagBadge";

const SCROLL_END_THRESHOLD = 24;
const SCROLLBAR_HIDE_DELAY_MS = 800;

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
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const pinnedToEndRef = useRef(true);
  const programmaticScrollDepthRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollbarTimeoutRef = useRef<number | null>(null);
  const headHash = commits[0]?.hash ?? "";

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
    const container = scrollRef.current;
    const track = container?.querySelector(".timeline-track");
    if (!container) return;

    const observer = new ResizeObserver(() => {
      scheduleApplyScrollPosition();
    });

    observer.observe(container);
    if (track) observer.observe(track);

    return () => observer.disconnect();
  }, [scheduleApplyScrollPosition]);

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

  return (
    <div className="history-timeline">
      <div className="timeline-scroller" onScroll={handleScroll} ref={scrollRef}>
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
            className={`timeline-node working-tree ${workingTreeActive ? "active" : ""}`}
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
            renderCommitNode(commit, ancestry.length + index, index < ahead.length - 1, true),
          )}
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
