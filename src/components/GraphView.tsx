import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ExternalLink, X } from "lucide-react";
import type { CommitEntry, WorktreeEntry } from "../types";
import { buildGraphRows, laneColor } from "../lib/graph";

type GraphViewProps = {
  /** Multi-branch history, newest first. */
  commits: CommitEntry[];
  headHash?: string;
  selectedHash?: string;
  /** Retained while tag controls stay owned by the Home timeline. */
  unpushedTags?: Set<string>;
  worktrees?: WorktreeEntry[];
  onSelect: (commit: CommitEntry) => void;
  /** Opens a different checkout; it never checks a branch out over this one. */
  onOpenWorktree?: (path: string) => void;
};

type SceneNode = {
  commit: CommitEntry;
  x: number;
  y: number;
  scale: number;
  colour: string;
  trunk: boolean;
  current: boolean;
  index: number;
};

type BranchPath = {
  hashes: Set<string>;
  offset: number;
  colour: string;
};

const CANVAS_W = 1200;
const CANVAS_H = 650;
const FLOOR_HORIZON_Y = 174;
const MAX_SCENE_COMMITS = 80;

function lineToRoot(head: string, commitsByHash: Map<string, CommitEntry>, trunk: Set<string>) {
  const hashes = new Set<string>();
  let cursor: string | undefined = head;
  while (cursor && !hashes.has(cursor)) {
    hashes.add(cursor);
    if (trunk.has(cursor)) break;
    cursor = commitsByHash.get(cursor)?.parents[0];
  }
  return hashes;
}

function labelForFolder(entry: WorktreeEntry) {
  if (entry.isMain) return entry.branch ?? "main";
  return entry.branch ?? `detached at ${entry.head.slice(0, 7)}`;
}

function folderState(entry: WorktreeEntry) {
  if (entry.isCurrent) return "open here";
  if (entry.isMain) return "trunk";
  if ((entry.changeCount ?? 0) > 0) {
    return `${entry.changeCount} uncommitted ${entry.changeCount === 1 ? "change" : "changes"}`;
  }
  if (entry.mergedIntoMain === true) return "merged into main";
  return "open in another folder";
}

/**
 * A history graph viewed in perspective instead of as a ledger.
 *
 * The trunk is the stable centre line. Recent commits sit close to the viewer,
 * large and widely spaced; old history compresses into the distance. Actual
 * parent edges still do the important work: a branch visibly leaves the trunk,
 * and a merge visibly returns to it. Folder labels are anchored to their real
 * checked-out commits rather than floating in a separate summary.
 */
export function GraphView({
  commits,
  headHash,
  selectedHash,
  worktrees = [],
  onSelect,
  onOpenWorktree,
}: GraphViewProps) {
  const [inspectedHash, setInspectedHash] = useState(selectedHash ?? "");
  useEffect(() => {
    if (selectedHash) setInspectedHash(selectedHash);
  }, [selectedHash]);
  const scene = useMemo(() => {
    const rows = buildGraphRows(commits, headHash).slice(0, MAX_SCENE_COMMITS);
    const commitsByHash = new Map(commits.map((commit) => [commit.hash, commit]));
    const visibleFolders = worktrees.filter((entry) => !entry.internal && !entry.prunable);
    const mainFolder = visibleFolders.find((entry) => entry.isMain);

    // The main folder's first-parent lineage is the central trunk, regardless
    // of which folder happens to be open in Gitty right now.
    const trunk = new Set<string>();
    let trunkCursor = mainFolder?.head;
    while (trunkCursor && commitsByHash.has(trunkCursor) && !trunk.has(trunkCursor)) {
      trunk.add(trunkCursor);
      trunkCursor = commitsByHash.get(trunkCursor)?.parents[0];
    }

    const activeFolders = visibleFolders.filter(
      (entry) => !entry.isMain && entry.mergedIntoMain !== true,
    );
    const paths: BranchPath[] = activeFolders.map((entry, index) => {
      const ring = Math.floor(index / 2);
      const side = index % 2 === 0 ? -1 : 1;
      return {
        hashes: lineToRoot(entry.head, commitsByHash, trunk),
        // The map is the whole workspace surface, not a thumbnail. Spread
        // open lines across it so their divergence can be read at a glance.
        offset: side * (270 + ring * 120),
        colour: laneColor(index + 1),
      };
    });
    const branchFor = new Map<string, BranchPath>();
    for (const path of paths) {
      for (const hash of path.hashes) {
        if (!trunk.has(hash) && !branchFor.has(hash)) branchFor.set(hash, path);
      }
    }

    const nodes = new Map<string, SceneNode>();
    const count = Math.max(rows.length - 1, 1);
    rows.forEach((row, index) => {
      const age = index / count;
      // A square-root perspective gives nearby commits room and lets a deep
      // past remain visible rather than becoming a second scrollable list.
      const distance = Math.sqrt(age);
      const scale = 1 - distance * 0.61;
      const branch = branchFor.get(row.commit.hash);
      const trunkCommit = trunk.has(row.commit.hash);
      const laneSide = row.lane % 2 === 0 ? -1 : 1;
      const fallbackOffset = laneSide * (220 + row.lane * 100);
      const offset = trunkCommit ? 0 : branch?.offset ?? fallbackOffset;
      nodes.set(row.commit.hash, {
        commit: row.commit,
        x: CANVAS_W / 2 + offset * scale,
        y: 592 - distance * 520,
        scale,
        colour: trunkCommit ? "#60a5fa" : branch?.colour ?? row.color,
        trunk: trunkCommit,
        current: row.commit.hash === headHash,
        index,
      });
    });

    return { nodes, rows, visibleFolders, mainFolder };
  }, [commits, headHash, worktrees]);

  const cursor = Math.max(
    0,
    scene.rows.findIndex((row) => row.commit.hash === selectedHash),
  );
  const inspectedCommit = scene.nodes.get(inspectedHash)?.commit ?? null;
  const inspectedFolder = scene.visibleFolders.find((entry) => entry.head === inspectedHash) ?? null;

  function moveFocus(index: number, delta: number, element: SVGGElement) {
    const next = Math.max(0, Math.min(scene.rows.length - 1, index + delta));
    const graph = element.closest<SVGSVGElement>(".constellation-canvas");
    graph?.querySelectorAll<SVGGElement>(".constellation-commit")[next]?.focus();
  }

  function inspectCommit(
    event: ReactKeyboardEvent<SVGGElement>,
    node: SceneNode,
  ) {
    const delta = event.key === "ArrowUp" || event.key === "ArrowLeft" ? 1
      : event.key === "ArrowDown" || event.key === "ArrowRight" ? -1
        : 0;
    if (delta !== 0) {
      event.preventDefault();
      event.stopPropagation();
      moveFocus(node.index, delta, event.currentTarget);
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setInspectedHash(node.commit.hash);
    }
  }

  if (scene.rows.length === 0) {
    return <div className="constellation-empty">No history to draw yet.</div>;
  }

  return (
    <section className="constellation-view" aria-label="Repository map">
      <div className="constellation-stage">
        <svg
          className="constellation-canvas"
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          role="img"
          aria-label="A perspective graph of branches, merges, commits, and open folders"
        >
          <defs>
            <radialGradient id="constellation-glow" cx="50%" cy="75%" r="65%">
              <stop offset="0" stopColor="#3b82f6" stopOpacity="0.14" />
              <stop offset="1" stopColor="#3b82f6" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="constellation-floor" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--border)" stopOpacity="0" />
              <stop offset="1" stopColor="var(--border)" stopOpacity="0.75" />
            </linearGradient>
          </defs>
          <rect width={CANVAS_W} height={CANVAS_H} fill="url(#constellation-glow)" />
          <g className="constellation-depth-grid" aria-hidden>
            <path
              className="constellation-floor-fill"
              d={`M 600 ${FLOOR_HORIZON_Y} L 1168 ${CANVAS_H} L 32 ${CANVAS_H} Z`}
              fill="url(#constellation-floor)"
            />
            {[0.07, 0.15, 0.27, 0.43, 0.64, 0.88].map((depth) => {
              const y = FLOOR_HORIZON_Y + (CANVAS_H - FLOOR_HORIZON_Y) * Math.pow(depth, 0.64);
              return <path key={depth} d={`M 78 ${y} L 1122 ${y}`} />;
            })}
            {[-4, -3, -2, -1, 0, 1, 2, 3, 4].map((lane) => (
              <path key={lane} d={`M 600 ${FLOOR_HORIZON_Y} L ${600 + lane * 146} ${CANVAS_H}`} />
            ))}
          </g>

          <g className="constellation-edges" aria-hidden>
            {[...scene.nodes.values()].flatMap((node) =>
              node.commit.parents.map((parentHash, parentIndex) => {
                const parent = scene.nodes.get(parentHash);
                if (!parent) return null;
                const dx = parent.x - node.x;
                const path = `M ${node.x} ${node.y} C ${node.x + dx * 0.14} ${node.y - 46 * node.scale}, ${parent.x - dx * 0.14} ${parent.y + 36 * parent.scale}, ${parent.x} ${parent.y}`;
                return (
                  <path
                    key={`${node.commit.hash}-${parentHash}-${parentIndex}`}
                    d={path}
                    style={{ stroke: node.colour, opacity: node.trunk ? 0.76 : 0.55 }}
                    className={node.trunk ? "trunk" : ""}
                  />
                );
              }),
            )}
          </g>

          <g className="constellation-nodes">
            {[...scene.nodes.values()].map((node) => {
              const active = node.commit.hash === selectedHash;
              const radius = 6 + node.scale * 6;
              return (
                <g
                  key={node.commit.hash}
                  className={`constellation-commit${node.trunk ? " trunk" : ""}${node.current ? " current" : ""}${active ? " active" : ""}`}
                  transform={`translate(${node.x} ${node.y}) scale(${node.scale})`}
                  role="button"
                  tabIndex={node.index === cursor ? 0 : -1}
                  onClick={() => setInspectedHash(node.commit.hash)}
                  onKeyDown={(event) => inspectCommit(event, node)}
                >
                  <title>{`${node.commit.shortHash} · ${node.commit.subject}`}</title>
                  {node.current ? <circle r={radius + 8} className="constellation-current-ring" /> : null}
                  <circle r={radius} style={{ fill: node.colour, stroke: node.colour }} />
                  {node.trunk && node.commit.parents.length > 1 ? (
                    <path className="constellation-merge-mark" d="M -3 0 L -0.5 2.6 L 4 -3" />
                  ) : null}
                </g>
              );
            })}
          </g>

          <g className="constellation-folder-labels">
            {scene.visibleFolders.map((entry, index) => {
              const node = scene.nodes.get(entry.head);
              if (!node) return null;
              const dirty = (entry.changeCount ?? 0) > 0;
              const merged = entry.mergedIntoMain === true;
              const label = labelForFolder(entry);
              const state = folderState(entry);
              const left = node.x < CANVAS_W / 2 || entry.isMain;
              const direction = left ? -1 : 1;
              const width = Math.min(250, Math.max(126, label.length * 7.2 + 38));
              const x = node.x + direction * (22 + width / 2) * node.scale;
              const y = node.y + (index % 2 === 0 ? -20 : 26) * node.scale;
              const tone = entry.isCurrent ? "current" : dirty ? "dirty" : merged ? "merged" : "open";
              return (
                <g
                  key={entry.path}
                  className={`constellation-folder ${tone}`}
                  transform={`translate(${x} ${y}) scale(${node.scale})`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setInspectedHash(node.commit.hash)}
                  onDoubleClick={() => {
                    if (!entry.isCurrent) onOpenWorktree?.(entry.path);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setInspectedHash(node.commit.hash);
                    }
                  }}
                >
                  <title>{entry.isCurrent ? `${label} is open here` : `Double-click ${label} to open its folder safely`}</title>
                  <rect x={-width / 2} y="-19" width={width} height="38" rx="7" />
                  {dirty ? <circle cx={-width / 2 + 12} cy="-4" r="4" /> : null}
                  <text className="constellation-folder-name" x={-width / 2 + (dirty ? 22 : 11)} y="-2">
                    {label}
                  </text>
                  <text className="constellation-folder-state" x={-width / 2 + 11} y="12">
                    {state}
                  </text>
                </g>
              );
            })}
          </g>

          {scene.mainFolder ? (
            <text className="constellation-trunk-caption" x={CANVAS_W / 2} y="628" textAnchor="middle">
              {labelForFolder(scene.mainFolder)} · trunk
            </text>
          ) : null}
        </svg>
        {inspectedCommit ? (
          <aside className="constellation-inspector" aria-label="Selected commit details">
            <button
              type="button"
              className="constellation-inspector-close"
              aria-label="Close commit details"
              onClick={() => setInspectedHash("")}
            >
              <X size={14} />
            </button>
            <p className="constellation-inspector-kicker">
              {inspectedFolder ? "Folder endpoint" : "Commit"}
            </p>
            <h3>{inspectedFolder ? labelForFolder(inspectedFolder) : inspectedCommit.subject}</h3>
            {inspectedFolder ? (
              <p className="constellation-inspector-state">{folderState(inspectedFolder)}</p>
            ) : null}
            <dl>
              <dt>Commit</dt><dd><code>{inspectedCommit.shortHash}</code></dd>
              <dt>Author</dt><dd>{inspectedCommit.author}</dd>
              <dt>When</dt><dd>{new Date(inspectedCommit.date).toLocaleString()}</dd>
              <dt>Parents</dt><dd>{inspectedCommit.parents.length || "none"}</dd>
            </dl>
            <div className="constellation-inspector-actions">
              <button type="button" className="constellation-inspector-detail" onClick={() => onSelect(inspectedCommit)}>
                <ExternalLink size={13} /> View files and diff
              </button>
              {inspectedFolder && !inspectedFolder.isCurrent && onOpenWorktree ? (
                <button
                  type="button"
                  className="constellation-inspector-open"
                  onClick={() => onOpenWorktree(inspectedFolder.path)}
                >
                  Open this folder safely
                </button>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>

    </section>
  );
}
