import {
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { CommitEntry, WorktreeEntry } from "../types";
import { buildCommitTagMenuItems } from "../lib/commitTags";
import { buildGraphRows, laneColor } from "../lib/graph";
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
import { ContextMenu } from "./ContextMenu";

/// Horizontal distance between lanes, and the vertical rhythm of one row. Both
/// feed the SVG geometry, so the strands and the dots cannot drift apart.
///
/// ROW_H is also published to CSS as --graph-row-h below. The row must be
/// exactly this tall: the SVG is drawn at a fixed height, and a row that grows
/// past it tears the lanes away from the content they belong to.
const LANE_W = 20;
const ROW_H = 44;

/// Shown until dismissed, then never again. A preference this small doesn't
/// justify a backend command and the three-edit contract that comes with it.
const LEGEND_DISMISSED_KEY = "gitty.graphLegendDismissed";

/// What the dots mean, stated once where they're drawn.
///
/// The grammar was written down in docs/GRAPH_VISUAL_LANGUAGE.md and nowhere a
/// user would ever encounter it, so a filled dot next to a hollow one read as
/// decoration. "I can't tell what I'm looking at" was the accurate response to
/// an interface that never said.
function GraphLegend({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="graph-legend">
      <span className="graph-legend-item">
        <svg width="14" height="14" aria-hidden>
          <circle cx="7" cy="7" r="5" className="graph-dot on-head legend-dot" />
        </svg>
        On the branch you have open
      </span>
      <span className="graph-legend-item">
        <svg width="14" height="14" aria-hidden>
          <circle cx="7" cy="7" r="4" className="graph-dot legend-dot" />
        </svg>
        On another branch
      </span>
      <span className="graph-legend-item">
        {[0, 1, 2].map((lane) => (
          <span
            key={lane}
            className="graph-legend-swatch"
            style={{ background: laneColor(lane) }}
            aria-hidden
          />
        ))}
        A colour per branch, kept for its whole run
      </span>
      <button type="button" className="graph-legend-dismiss" onClick={onDismiss}>
        Got it
      </button>
    </div>
  );
}

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
  onVisitCommit?: (commit: CommitEntry) => void;
  onCreateTag?: (commit: CommitEntry) => void;
  onDeleteTag?: (commit: CommitEntry, name: string) => void;
  onBranchFrom?: (commit: CommitEntry) => void;
  onResetTo?: (commit: CommitEntry) => void;
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
  onVisitCommit,
  onCreateTag,
  onDeleteTag,
  onBranchFrom,
  onResetTo,
}: GraphViewProps) {
  const rows = useMemo(() => buildGraphRows(commits, headHash), [commits, headHash]);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ReturnType<typeof buildCommitTagMenuItems>;
  } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  // Read once on mount rather than on every render; a throwing localStorage
  // (private mode, disabled storage) must not take the whole view down with it.
  const [legendDismissed, setLegendDismissed] = useState(() => {
    try {
      return localStorage.getItem(LEGEND_DISMISSED_KEY) === "1";
    } catch {
      return true;
    }
  });
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

  // Which row currently holds the list's single tab stop.
  //
  // Roving tabindex, not 40 tab stops: the timeline this view sits beside is
  // fully keyboard-driven, and a list you can only cross with forty presses is
  // not the same commitment. One stop to enter, arrows to move, Enter to open
  // -- which is what the rows already do, being real buttons.
  const cursor = Math.max(
    0,
    rows.findIndex((row) => row.commit.hash === selectedHash),
  );

  function moveFocus(from: number, delta: number, list: HTMLElement | null) {
    if (!list) return;
    const next = Math.min(rows.length - 1, Math.max(0, from + delta));
    const buttons = list.querySelectorAll<HTMLButtonElement>(".graph-row");
    buttons[next]?.focus();
  }

  function onRowKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const list = event.currentTarget.closest<HTMLElement>(".graph-rows");
    const jump: Record<string, number | "home" | "end"> = {
      ArrowDown: 1,
      ArrowUp: -1,
      PageDown: 10,
      PageUp: -10,
      Home: "home",
      End: "end",
    };
    const move = jump[event.key];
    if (move === undefined) return;
    // Claimed here so the window-level timeline handler, which listens in the
    // capture phase, cannot also act on the same press.
    event.preventDefault();
    event.stopPropagation();
    if (move === "home") moveFocus(0, 0, list);
    else if (move === "end") moveFocus(rows.length - 1, 0, list);
    else moveFocus(index, move, list);
  }

  function openCommitContextMenu(event: React.MouseEvent, commit: CommitEntry) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: buildCommitTagMenuItems(commit, {
        onVisitCommit,
        onCreateTag,
        onDeleteTag,
        onBranchFrom,
        onResetTo,
      }),
    });
  }

  if (rows.length === 0) {
    return <div className="graph-empty">No history to draw.</div>;
  }

  const laneX = (lane: number) => lane * LANE_W + LANE_W / 2;

  return (
    <div className="graph-view">
      {legendDismissed ? null : (
        <GraphLegend
          onDismiss={() => {
            setLegendDismissed(true);
            try {
              localStorage.setItem(LEGEND_DISMISSED_KEY, "1");
            } catch {
              // Dismissed for this session either way; storage is a nicety.
            }
          }}
        />
      )}
      <ol
        className="graph-rows"
        style={{
          ["--graph-gutter" as string]: `${gutter}px`,
          ["--graph-row-h" as string]: `${ROW_H}px`,
        }}
      >
        {rows.map((row, index) => {
          const tags = tagRefs(row.commit.refs).map(tagName);
          const active = row.commit.hash === selectedHash;
          return (
            <li key={row.commit.hash}>
              <button
                type="button"
                className={`graph-row${active ? " active" : ""}${row.onHead ? " on-head" : ""}`}
                onClick={() => onSelect(row.commit)}
                onContextMenu={(event) => openCommitContextMenu(event, row.commit)}
                onKeyDown={(event) => onRowKeyDown(event, index)}
                tabIndex={index === cursor ? 0 : -1}
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
                      when it belongs to another branch.

                      The <title> is the whole grammar lesson, delivered where
                      the question is actually asked. It was documented only in
                      docs/GRAPH_VISUAL_LANGUAGE.md, which is to say nowhere a
                      user goes. */}
                  <circle
                    className={`graph-dot${row.onHead ? " on-head" : ""}`}
                    cx={laneX(row.lane)}
                    cy={ROW_H / 2}
                    r={row.onHead ? 5 : 4}
                    style={{ stroke: row.color, fill: row.onHead ? row.color : undefined }}
                  >
                    <title>
                      {row.onHead
                        ? "On the branch you have open."
                        : "On another branch, not the one you have open."}
                    </title>
                  </circle>
                </svg>

                {/* Labels and message share one cell so the text column starts
                    at the same place on every row. As separate grid tracks the
                    refs column resolved per row -- 0px on most, 276px on a
                    labelled one -- so the subject began at eight different x
                    positions down a list whose whole job is being scanned. The
                    badge stays immediately before the message it belongs to,
                    which is where every other client puts it. */}
                <span className="graph-message">
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
                </span>
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
                  {tags.length > 0 ? (
                    <TagBadge
                      name={tags[0]}
                      unpushed={unpushedTags?.has(tags[0])}
                      muted
                      additionalCount={tags.length - 1}
                      title={tags.join(", ")}
                    />
                  ) : null}
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
