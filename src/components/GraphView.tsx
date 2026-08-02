import { useMemo } from "react";
import type { CommitEntry } from "../types";
import { buildGraphRows } from "../lib/graph";
import { formatRelativeTime, authorInitials, tagName, tagRefs } from "../lib/git";
import { TagBadge } from "./TagBadge";

/// Horizontal distance between lanes, and the vertical rhythm of one row. Both
/// feed the SVG geometry, so the strands and the dots cannot drift apart.
const LANE_W = 20;
const ROW_H = 44;

type GraphViewProps = {
  /// Multi-branch history (`graphCommits`), newest first.
  commits: CommitEntry[];
  headHash?: string;
  selectedHash?: string;
  unpushedTags?: Set<string>;
  onSelect: (commit: CommitEntry) => void;
};

/// The dense end of the visual language: many branches, so colour does identity
/// work here (a lane keeps its colour for its whole run). Fill still answers
/// "is this on my line", and weight still separates your branch from context.
export function GraphView({
  commits,
  headHash,
  selectedHash,
  unpushedTags,
  onSelect,
}: GraphViewProps) {
  const rows = useMemo(() => buildGraphRows(commits, headHash), [commits, headHash]);
  const laneCount = rows[0]?.laneCount ?? 1;
  const gutter = Math.max(laneCount * LANE_W + LANE_W, LANE_W * 3);

  if (rows.length === 0) {
    return <div className="graph-empty">No history to draw.</div>;
  }

  const laneX = (lane: number) => lane * LANE_W + LANE_W / 2;

  return (
    <div className="graph-view">
      <ol className="graph-rows" style={{ ["--graph-gutter" as string]: `${gutter}px` }}>
        {rows.map((row) => {
          const tags = tagRefs(row.commit.refs).map(tagName);
          const active = row.commit.hash === selectedHash;
          return (
            <li key={row.commit.hash}>
              <button
                type="button"
                className={`graph-row${active ? " active" : ""}${row.onHead ? " on-head" : ""}`}
                onClick={() => onSelect(row.commit)}
                title={`${row.commit.shortHash} · ${row.commit.subject}`}
              >
                <svg
                  className="graph-lanes"
                  width={gutter}
                  height={ROW_H}
                  viewBox={`0 0 ${gutter} ${ROW_H}`}
                  aria-hidden
                >
                  {/* Strands leaving this row toward the next one. Drawn first so
                      the dot always sits on top of them. overflow is visible so a
                      curve can run into the following row's band. */}
                  {row.edges.map((edge, i) => {
                    const x1 = laneX(edge.fromLane);
                    const x2 = laneX(edge.toLane);
                    const y1 = ROW_H / 2;
                    const y2 = ROW_H + ROW_H / 2;
                    const d =
                      x1 === x2
                        ? `M ${x1} ${y1} L ${x2} ${y2}`
                        : `M ${x1} ${y1} C ${x1} ${y1 + ROW_H * 0.55}, ${x2} ${y2 - ROW_H * 0.55}, ${x2} ${y2}`;
                    return (
                      <path
                        key={`${edge.fromLane}-${edge.toLane}-${i}`}
                        d={d}
                        className={`graph-strand${edge.onHead ? " on-head" : ""}`}
                        style={{ stroke: edge.color }}
                      />
                    );
                  })}
                  {/* Fill answers "is this on my line": solid when it is, hollow
                      when it belongs to another branch. */}
                  <circle
                    className={`graph-dot${row.onHead ? " on-head" : ""}`}
                    cx={laneX(row.lane)}
                    cy={ROW_H / 2}
                    r={row.onHead ? 5 : 4}
                    style={{ stroke: row.color, fill: row.onHead ? row.color : undefined }}
                  />
                </svg>

                <span className="graph-subject">{row.commit.subject}</span>
                {tags.length > 0 ? (
                  <span className="graph-tags">
                    {tags.map((name) => (
                      <TagBadge key={name} name={name} unpushed={unpushedTags?.has(name)} muted />
                    ))}
                  </span>
                ) : null}
                <span className="graph-author" title={row.commit.author}>
                  {authorInitials(row.commit.author)}
                </span>
                <span className="graph-hash">{row.commit.shortHash}</span>
                <span className="graph-time">{formatRelativeTime(row.commit.date)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
