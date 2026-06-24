import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { CommitEntry } from "../types";
import { laneColor } from "../lib/graph";

const SCROLL_END_THRESHOLD = 24;
const SCROLLBAR_HIDE_DELAY_MS = 800;

type HistoryTimelineProps = {
  commits: CommitEntry[];
  changeCount: number;
  selectedHash?: string;
  onSelect: (commit: CommitEntry) => void;
  onSelectWorkingTree: () => void;
  onInteract?: () => void;
  workingTreeActive?: boolean;
};

export function HistoryTimeline({
  commits,
  changeCount,
  selectedHash,
  onSelect,
  onSelectWorkingTree,
  onInteract,
  workingTreeActive,
}: HistoryTimelineProps) {
  const visible = [...commits].reverse();
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
  }, [headHash, selectedHash, workingTreeActive, visible.length, scheduleApplyScrollPosition]);

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

  return (
    <div className="history-timeline">
      <div className="timeline-scroller" onScroll={handleScroll} ref={scrollRef}>
        <div className="timeline-track">
        {visible.map((commit, index) => {
          const color = laneColor(index % 6);
          const active = commit.hash === selectedHash && !workingTreeActive;
          return (
            <button
              className={`timeline-node ${active ? "active" : ""}`}
              key={commit.hash}
              type="button"
              ref={(node) => {
                if (node) nodeRefs.current.set(commit.hash, node);
                else nodeRefs.current.delete(commit.hash);
              }}
              onClick={() => selectCommit(commit)}
              title={`${commit.shortHash} · ${commit.subject}`}
            >
              <span className="node-dot" style={{ background: color, boxShadow: `0 0 12px ${color}55` }} />
              <span className="node-hash">{commit.shortHash}</span>
              <span className="node-subject">{commit.subject}</span>
              {index < visible.length - 1 || changeCount > 0 ? (
                <span className="node-connector" style={{ background: color }} />
              ) : null}
            </button>
          );
        })}

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
        </button>
      </div>
      </div>
    </div>
  );
}
