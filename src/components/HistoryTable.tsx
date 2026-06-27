import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { CommitEntry } from "../types";
import {
  authorInitials,
  formatCommitDate,
  formatCommitTime,
  parseRefs,
  primaryRef,
  tagName,
  tagRefs,
} from "../lib/git";
import { buildGraphRows } from "../lib/graph";
import { buildCommitTagMenuItems } from "../lib/commitTags";
import { ContextMenu } from "./ContextMenu";
import { TagBadge } from "./TagBadge";

type HistoryTableProps = {
  commits: CommitEntry[];
  aheadHashes?: Set<string>;
  unpushedTags?: Set<string>;
  selectedHash?: string;
  search: string;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onSelect: (commit: CommitEntry) => void;
  onVisitCommit?: (commit: CommitEntry) => void;
  onCreateTag?: (commit: CommitEntry) => void;
  onDeleteTag?: (commit: CommitEntry, name: string) => void;
};

const SCROLL_LOAD_THRESHOLD = 120;

// Fixed row geometry so the graph strands of adjacent rows line up centre-to-
// centre. Each row's SVG draws the half-curves into the gaps above and below;
// neighbouring rows draw the matching halves, so the curves meet.
const ROW_H = 36;
const LANE_W = 14;
const laneX = (lane: number) => 12 + lane * LANE_W;

export function HistoryTable({
  commits,
  aheadHashes,
  unpushedTags,
  selectedHash,
  search,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onSelect,
  onVisitCommit,
  onCreateTag,
  onDeleteTag,
}: HistoryTableProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  loadingMoreRef.current = loadingMore;

  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !onLoadMore || !hasMore) return;

    function handleScroll() {
      const container = bodyRef.current;
      if (!container || loadingMoreRef.current) return;
      const remaining = container.scrollHeight - container.clientHeight - container.scrollTop;
      if (remaining <= SCROLL_LOAD_THRESHOLD) {
        onLoadMore?.();
      }
    }

    body.addEventListener("scroll", handleScroll, { passive: true });
    return () => body.removeEventListener("scroll", handleScroll);
  }, [hasMore, onLoadMore]);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ReturnType<typeof buildCommitTagMenuItems>;
  } | null>(null);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const tagActionsEnabled = !!(onCreateTag && onDeleteTag);

  const query = search.trim().toLowerCase();
  const filtered = query
    ? commits.filter(
        (commit) =>
          commit.subject.toLowerCase().includes(query) ||
          commit.author.toLowerCase().includes(query) ||
          commit.shortHash.toLowerCase().includes(query) ||
          commit.refs.toLowerCase().includes(query),
      )
    : commits;
  const rows = buildGraphRows(filtered);
  const laneCount = Math.max(rows[0]?.laneCount ?? 1, 1);
  const graphWidth = laneCount * LANE_W + 10;

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

  return (
    <div className="history-table-wrap">
      <div className="history-table">
        <div className="history-header">
          <span className="col-graph">Graph</span>
          <span className="col-branch">Branch</span>
          <span className="col-message">Commit message</span>
          <span className="col-hash">Hash</span>
          <span className="col-date">Date</span>
          <span className="col-time">Time</span>
          <span className="col-author">Author</span>
        </div>

        <div className="history-body" ref={bodyRef}>
          {rows.map((row, idx) => {
            const refs = parseRefs(row.commit.refs);
            const mainRef = primaryRef(row.commit.refs);
            const tags = tagRefs(row.commit.refs).map(tagName);
            const active = row.commit.hash === selectedHash;
            const refColor = row.color;
            const isAhead = aheadHashes?.has(row.commit.hash) ?? false;
            const edgesAbove = idx > 0 ? rows[idx - 1].edges : [];

            return (
              <button
                className={`history-row ${active ? "active" : ""} ${isAhead ? "ahead" : ""}`}
                key={row.commit.hash}
                type="button"
                onClick={() => onSelect(row.commit)}
                onContextMenu={(event) => openTagContextMenu(event, row.commit)}
              >
                <div className="col-graph" style={{ width: graphWidth }}>
                  <svg
                    className="graph-svg"
                    width={graphWidth}
                    height={ROW_H}
                    aria-hidden="true"
                  >
                    {edgesAbove.map((edge, ei) => {
                      const xf = laneX(edge.fromLane);
                      const xt = laneX(edge.toLane);
                      const d =
                        xf === xt
                          ? `M ${xf} ${-ROW_H / 2} L ${xt} ${ROW_H / 2}`
                          : `M ${xf} ${-ROW_H / 2} C ${xf} 0 ${xt} 0 ${xt} ${ROW_H / 2}`;
                      return (
                        <path key={`t${ei}`} d={d} fill="none" stroke={edge.color} strokeWidth={2} />
                      );
                    })}
                    {row.edges.map((edge, ei) => {
                      const xf = laneX(edge.fromLane);
                      const xt = laneX(edge.toLane);
                      const d =
                        xf === xt
                          ? `M ${xf} ${ROW_H / 2} L ${xt} ${ROW_H * 1.5}`
                          : `M ${xf} ${ROW_H / 2} C ${xf} ${ROW_H} ${xt} ${ROW_H} ${xt} ${ROW_H * 1.5}`;
                      return (
                        <path key={`b${ei}`} d={d} fill="none" stroke={edge.color} strokeWidth={2} />
                      );
                    })}
                    <circle
                      cx={laneX(row.lane)}
                      cy={ROW_H / 2}
                      r={5}
                      fill={refColor}
                      stroke="var(--bg-panel)"
                      strokeWidth={2}
                    />
                  </svg>
                </div>

                <div className="col-branch">
                  <div className="ref-badges">
                    {mainRef ? (
                      <span
                        className="branch-badge"
                        style={{
                          background: `${refColor}18`,
                          color: refColor,
                          borderColor: `${refColor}40`,
                        }}
                      >
                        {mainRef}
                      </span>
                    ) : refs[0] && !refs[0].startsWith("tag:") ? (
                      <span className="branch-badge muted">{refs[0]}</span>
                    ) : null}
                    {tags.map((name) => (
                      <TagBadge
                        key={name}
                        name={name}
                        unpushed={unpushedTags?.has(name)}
                      />
                    ))}
                  </div>
                </div>

                <div className="col-message" title={row.commit.subject}>
                  {row.commit.subject}
                  {isAhead ? <span className="option-ahead-badge">ahead</span> : null}
                </div>
                <div className="col-hash">{row.commit.shortHash}</div>
                <div className="col-date">{formatCommitDate(row.commit.date)}</div>
                <div className="col-time">{formatCommitTime(row.commit.date)}</div>
                <div className="col-author">
                  <span className="author-avatar">{authorInitials(row.commit.author)}</span>
                  <span>{row.commit.author.split(" ")[0]}</span>
                </div>
              </button>
            );
          })}

          {hasMore ? (
            <div className="history-load-more">
              <button
                type="button"
                className="ghost-btn history-load-more-btn"
                disabled={loadingMore}
                onClick={() => onLoadMore?.()}
              >
                {loadingMore ? <Loader2 size={14} className="spin" /> : null}
                {loadingMore ? "Loading older commits…" : "Load older commits"}
              </button>
            </div>
          ) : null}
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
