import { useMemo } from "react";
import type { CommitEntry, WorktreeEntry } from "../types";
import { buildGraphRows } from "../lib/graph";
import {
  authorInitials,
  branchRefs,
  folderName,
  formatRelativeTime,
  tagName,
  tagRefs,
} from "../lib/git";
import { GitBranch, SquareArrowOutUpRight } from "lucide-react";
import { TagBadge } from "./TagBadge";

/// Horizontal distance between lanes, and the vertical rhythm of one row. Both
/// feed the SVG geometry, so the strands and the dots cannot drift apart.
///
/// ROW_H is also published to CSS as --graph-row-h below. The row must be
/// exactly this tall: the SVG is drawn at a fixed height, and a row that grows
/// past it tears the lanes away from the content they belong to.
const LANE_W = 20;
const ROW_H = 44;

type GraphViewProps = {
  /// Multi-branch history (`graphCommits`), newest first.
  commits: CommitEntry[];
  headHash?: string;
  /// The branch checked out in *this* folder, so its label can be marked as
  /// where you are rather than looking like any other branch.
  headBranch?: string;
  selectedHash?: string;
  unpushedTags?: Set<string>;
  /// Other checkouts of this repository, so rows can show which commits are
  /// the HEAD of a branch open in another folder.
  worktrees?: WorktreeEntry[];
  onSelect: (commit: CommitEntry) => void;
};

/// The dense end of the visual language: many branches, so colour does identity
/// work here (a lane keeps its colour for its whole run). Fill still answers
/// "is this on my line", and weight still separates your branch from context.
export function GraphView({
  commits,
  headHash,
  headBranch,
  selectedHash,
  unpushedTags,
  worktrees = [],
  onSelect,
}: GraphViewProps) {
  const rows = useMemo(() => buildGraphRows(commits, headHash), [commits, headHash]);
  // Several checkouts can sit on one commit, so this maps hash -> entries.
  const openElsewhere = useMemo(() => {
    const map = new Map<string, WorktreeEntry[]>();
    for (const entry of worktrees) {
      if (entry.isCurrent || entry.internal) continue;
      const list = map.get(entry.head) ?? [];
      list.push(entry);
      map.set(entry.head, list);
    }
    return map;
  }, [worktrees]);
  const laneCount = rows[0]?.laneCount ?? 1;
  const gutter = Math.max(laneCount * LANE_W + LANE_W, LANE_W * 3);

  if (rows.length === 0) {
    return <div className="graph-empty">No history to draw.</div>;
  }

  const laneX = (lane: number) => lane * LANE_W + LANE_W / 2;

  return (
    <div className="graph-view">
      <ol
        className="graph-rows"
        style={{
          ["--graph-gutter" as string]: `${gutter}px`,
          ["--graph-row-h" as string]: `${ROW_H}px`,
        }}
      >
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

                {/* The whole point of this view. Without them it's an
                    unlabelled column of dots and you can't tell which line is
                    which, or a branch from a checkout. */}
                <span className="graph-refs">
                {branchRefs(row.commit.refs).map((ref) => {
                  const local = ref.replace(/^HEAD -> /, "");
                  const remote = local.includes("/");
                  return (
                    <span
                      key={ref}
                      className={`graph-ref${remote ? " remote" : ""}${
                        local === headBranch ? " head" : ""
                      }`}
                      style={remote ? undefined : { borderColor: row.color }}
                      title={remote ? `${local} (on the remote)` : `${local} (branch)`}
                    >
                      <GitBranch size={10} aria-hidden />
                      {local}
                    </span>
                  );
                })}
                </span>
                <span className="graph-subject">{row.commit.subject}</span>
                {/* Every trailing item shares one cell. They used to be direct
                    children of the grid, so a row with a tag or a second
                    checkout had more items than the grid had columns and every
                    cell after it shifted, collapsing the subject to a sliver. */}
                <span className="graph-meta">
                  {/* A checkout in another folder is its own kind of fact, not a
                      degree of "is this mine", so it gets its own marker rather
                      than bending fill or weight to mean a third thing. */}
                  {openElsewhere.get(row.commit.hash)?.map((entry) => (
                    <span
                      key={entry.path}
                      className="graph-elsewhere"
                      title={`${entry.branch ?? "detached"} is checked out in ${entry.path}`}
                    >
                      <SquareArrowOutUpRight size={11} aria-hidden />
                      {folderName(entry.path)}
                    </span>
                  ))}
                  {tags.map((name) => (
                    <TagBadge key={name} name={name} unpushed={unpushedTags?.has(name)} muted />
                  ))}
                  <span className="graph-author" title={row.commit.author}>
                    {authorInitials(row.commit.author)}
                  </span>
                  <span className="graph-hash">{row.commit.shortHash}</span>
                  <span className="graph-time">{formatRelativeTime(row.commit.date)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
