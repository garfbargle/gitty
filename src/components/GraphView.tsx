import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { ExternalLink, Maximize2, Minimize2, RotateCcw, X } from "lucide-react";
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
  focused?: boolean;
  onFocusedChange?: (focused: boolean) => void;
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
  elevation: number;
};

type BranchPath = {
  hashes: Set<string>;
  offset: number;
  /** Used to order sibling departures along their shared time rail. */
  firstCommitTime: number;
  colour: string;
};

const CANVAS_W = 1200;
const CANVAS_H = 650;
const FLOOR_HORIZON_Y = 96;
const RAIL_NEAR_Y = 604;
const MAX_SCENE_COMMITS = 80;
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 2.8;
const DEFAULT_ZOOM = 1.16;
const MIN_TRAVEL = -0.18;
const MAX_TRAVEL = 0.78;

// This deliberately is not a free two-dimensional camera. History is a rail:
// you can move along time and change how close the rail feels, but never pull
// the graph away from the world it belongs to.
type Camera = { travel: number; scale: number };
type PointerPosition = { x: number; y: number };

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function clampTravel(value: number) {
  return Math.min(MAX_TRAVEL, Math.max(MIN_TRAVEL, value));
}

function pointerDistance(points: PointerPosition[]) {
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

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
  focused = false,
  onFocusedChange,
}: GraphViewProps) {
  const [inspectedHash, setInspectedHash] = useState(selectedHash ?? "");
  const [camera, setCamera] = useState<Camera>({ travel: 0, scale: DEFAULT_ZOOM });
  const cameraRef = useRef(camera);
  const activePointers = useRef(new Map<number, PointerPosition>());
  const panStart = useRef<{ pointer: PointerPosition; camera: Camera } | null>(null);
  const pinchStart = useRef<{
    distance: number;
    camera: Camera;
  } | null>(null);
  const panned = useRef(false);
  const updateCamera = useCallback((next: Camera) => {
    cameraRef.current = next;
    setCamera(next);
  }, []);

  useEffect(() => {
    if (selectedHash) setInspectedHash(selectedHash);
  }, [selectedHash]);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && focused) onFocusedChange?.(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focused, onFocusedChange]);
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

    // Git may return worktrees in a different order between refreshes. Sort
    // them before assigning lanes so a branch keeps a stable visual lane.
    const activeFolders = visibleFolders
      .filter((entry) => !entry.isMain && entry.mergedIntoMain !== true)
      .sort((left, right) => `${labelForFolder(left)}\u0000${left.path}`.localeCompare(
        `${labelForFolder(right)}\u0000${right.path}`,
      ));
    const paths: BranchPath[] = activeFolders.map((entry, index) => {
      const ring = Math.floor(index / 2);
      const side = index % 2 === 0 ? -1 : 1;
      const hashes = lineToRoot(entry.head, commitsByHash, trunk);
      const firstCommitTime = Math.min(
        ...[...hashes]
          .filter((hash) => !trunk.has(hash))
          .map((hash) => Date.parse(commitsByHash.get(hash)?.date ?? ""))
          .filter(Number.isFinite),
      );
      return {
        hashes,
        // The map is the whole workspace surface, not a thumbnail. Spread
        // open lines across it so their divergence can be read at a glance.
        offset: side * (270 + ring * 120),
        firstCommitTime: Number.isFinite(firstCommitTime) ? firstCommitTime : Number.MAX_SAFE_INTEGER,
        colour: laneColor(index + 1),
      };
    });
    const branchFor = new Map<string, BranchPath>();
    for (const path of paths) {
      for (const hash of path.hashes) {
        if (!trunk.has(hash) && !branchFor.has(hash)) branchFor.set(hash, path);
      }
    }

    // Not every historical branch has an open worktree. Give those graph-only
    // lanes stable identities too, so merged and closed branches participate
    // in the same time-ordered departure calculation.
    const graphOnlyPaths = new Map<number, BranchPath>();
    for (const row of rows) {
      if (trunk.has(row.commit.hash) || branchFor.has(row.commit.hash)) continue;
      const lane = Math.max(1, row.lane);
      let path = graphOnlyPaths.get(lane);
      if (!path) {
        const ring = Math.floor((lane - 1) / 2);
        const side = lane % 2 === 0 ? 1 : -1;
        const commitTime = Date.parse(row.commit.date);
        path = {
          hashes: new Set<string>(),
          offset: side * (270 + ring * 120),
          firstCommitTime: Number.isFinite(commitTime) ? commitTime : Number.MAX_SAFE_INTEGER,
          colour: row.color,
        };
        graphOnlyPaths.set(lane, path);
      }
      path.hashes.add(row.commit.hash);
      const commitTime = Date.parse(row.commit.date);
      if (Number.isFinite(commitTime)) {
        path.firstCommitTime = Math.min(path.firstCommitTime, commitTime);
      }
      branchFor.set(row.commit.hash, path);
    }

    // A fork joins the *same* trunk rail, but sibling branches should not all
    // leave from one pixel. Their first commit orders small fore/aft offsets
    // along that rail, which keeps the connection smooth and reproducible.
    const railOffsets = new Map<string, number>();
    const departuresByTrunk = new Map<string, { childHash: string; branch: BranchPath }[]>();
    for (const row of rows) {
      if (trunk.has(row.commit.hash)) continue;
      const branch = branchFor.get(row.commit.hash);
      if (!branch) continue;
      for (const parentHash of row.commit.parents) {
        if (!trunk.has(parentHash)) continue;
        const departures = departuresByTrunk.get(parentHash) ?? [];
        departures.push({ childHash: row.commit.hash, branch });
        departuresByTrunk.set(parentHash, departures);
      }
    }
    for (const [parentHash, departures] of departuresByTrunk) {
      departures
        .sort((left, right) => left.branch.firstCommitTime - right.branch.firstCommitTime
          || left.childHash.localeCompare(right.childHash))
        .forEach((departure, index) => {
          railOffsets.set(
            `${departure.childHash}:${parentHash}`,
            (index - (departures.length - 1) / 2) * 24,
          );
        });
    }

    const nodes = new Map<string, SceneNode>();
    const count = Math.max(rows.length - 1, 1);
    rows.forEach((row, index) => {
      const age = index / count;
      // A square-root perspective gives nearby commits room and lets a deep
      // past remain visible rather than becoming a second scrollable list.
      // Travelling moves the viewer down the history rail, rather than
      // translating this scene like a flat map.
      const relativeAge = Math.max(0, Math.min(1.25, age - camera.travel));
      // Linear time distance avoids the infinite near-camera acceleration a
      // square-root curve creates. The rational projection still makes deep
      // history recede, but it does so with a continuous, controllable rate.
      const distance = relativeAge;
      // Project the history down the same depth axis as the floor. Unlike a
      // linear Y offset, this asymptotically approaches the horizon: the
      // trunk travels *into* the vanishing point instead of continuing above
      // it like a vertical timeline.
      const depth = 1 / (1 + distance * 2.9);
      const scale = 0.36 + depth * 0.64;
      const branch = branchFor.get(row.commit.hash);
      const trunkCommit = trunk.has(row.commit.hash);
      const laneSide = row.lane % 2 === 0 ? -1 : 1;
      const fallbackOffset = laneSide * (220 + row.lane * 100);
      const offset = trunkCommit ? 0 : branch?.offset ?? fallbackOffset;
      // Non-trunk work floats slightly above the shared floor. This is a
      // visual Z axis, not fabricated history: it makes a branch's return to
      // the trunk read as a ramp rather than another line in the same plane.
      const elevation = trunkCommit ? 0 : 17 + Math.min(33, Math.abs(offset) * 0.07);
      nodes.set(row.commit.hash, {
        commit: row.commit,
        x: CANVAS_W / 2 + offset * depth,
        y: FLOOR_HORIZON_Y + (RAIL_NEAR_Y - FLOOR_HORIZON_Y) * depth - elevation * depth,
        scale,
        colour: trunkCommit ? "#60a5fa" : branch?.colour ?? row.color,
        trunk: trunkCommit,
        current: row.commit.hash === headHash,
        index,
        elevation,
      });
    });

    return { nodes, railOffsets, rows, visibleFolders, mainFolder };
  }, [camera.travel, commits, headHash, worktrees]);

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

  function beginGesture(event: ReactPointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = [...activePointers.current.values()];
    if (pointers.length === 1) {
      panStart.current = { pointer: pointers[0], camera: cameraRef.current };
      pinchStart.current = null;
    } else if (pointers.length === 2) {
      pinchStart.current = {
        distance: pointerDistance(pointers),
        camera: cameraRef.current,
      };
      panStart.current = null;
    }
  }

  function moveGesture(event: ReactPointerEvent<SVGSVGElement>) {
    if (!activePointers.current.has(event.pointerId)) return;
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = [...activePointers.current.values()];
    if (pointers.length >= 2 && pinchStart.current) {
      const scale = clampZoom(
        pinchStart.current.camera.scale * (pointerDistance(pointers) / pinchStart.current.distance),
      );
      if (Math.abs(scale - cameraRef.current.scale) > 0.01) panned.current = true;
      updateCamera({
        scale,
        travel: pinchStart.current.camera.travel,
      });
      return;
    }
    if (pointers.length === 1 && panStart.current) {
      const dy = pointers[0].y - panStart.current.pointer.y;
      if (Math.abs(dy) > 3) panned.current = true;
      updateCamera({
        ...panStart.current.camera,
        travel: clampTravel(panStart.current.camera.travel - dy * 0.0018),
      });
    }
  }

  function endGesture(event: ReactPointerEvent<SVGSVGElement>) {
    activePointers.current.delete(event.pointerId);
    const pointers = [...activePointers.current.values()];
    panStart.current = pointers.length === 1
      ? { pointer: pointers[0], camera: cameraRef.current }
      : null;
    pinchStart.current = null;
    // SVG click follows pointerup. Leave this set long enough to distinguish a
    // camera move from an intentful commit click.
    window.setTimeout(() => { panned.current = false; }, 0);
  }

  function moveThroughTime(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.002);
      updateCamera({ ...cameraRef.current, scale: clampZoom(cameraRef.current.scale * factor) });
      return;
    }
    // A wheel, trackpad, or DeX pointer moves only along the time rail. Use
    // whichever axis the input device provides most strongly.
    const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
      ? event.deltaY
      : event.deltaX;
    updateCamera({
      ...cameraRef.current,
      // Scroll forward should bring the next section of history toward the
      // viewer, matching the floor lines streaming out from the horizon.
      travel: clampTravel(cameraRef.current.travel - delta * 0.0018),
    });
  }

  if (scene.rows.length === 0) {
    return <div className="constellation-empty">No history to draw yet.</div>;
  }

  return (
    <section className={`constellation-view${focused ? " focused" : ""}`} aria-label="Repository map">
      <div className="constellation-stage">
        <div className="constellation-controls" aria-label="Graph view controls">
          <button
            type="button"
            className="constellation-control"
            onClick={() => updateCamera({ travel: 0, scale: DEFAULT_ZOOM })}
            title="Reset time position and zoom"
            aria-label="Reset time position and zoom"
          >
            <RotateCcw size={15} />
          </button>
          {onFocusedChange ? (
            <button
              type="button"
              className="constellation-control focus"
              onClick={() => onFocusedChange(!focused)}
              title={focused ? "Exit graph focus (Esc)" : "Focus graph"}
              aria-label={focused ? "Exit graph focus" : "Focus graph"}
              aria-pressed={focused}
            >
              {focused ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              <span>{focused ? "Exit focus" : "Focus graph"}</span>
            </button>
          ) : null}
        </div>
        <p className="constellation-navigation-hint" aria-hidden="true">
          Drag or scroll to travel through time · pinch or Ctrl+scroll to zoom
        </p>
        <svg
          className="constellation-canvas"
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="A perspective graph of branches, merges, commits, and open folders"
          onPointerDown={beginGesture}
          onPointerMove={moveGesture}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onWheel={moveThroughTime}
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
              d={`M 600 ${FLOOR_HORIZON_Y} L ${CANVAS_W + 100} ${CANVAS_H} L -100 ${CANVAS_H} Z`}
              fill="url(#constellation-floor)"
            />
            {Array.from({ length: 13 }, (_, index) => index).map((index) => {
              // As the rail advances, fresh grid lines emerge at the horizon
              // and stream past the viewer. It gives movement perspective
              // without ever detaching the graph from its background.
              const depth = 0.035 + ((index / 13 + camera.travel * 0.82) % 1 + 1) % 1;
              const y = FLOOR_HORIZON_Y + (CANVAS_H - FLOOR_HORIZON_Y) * Math.pow(depth, 0.64);
              return <path key={index} d={`M -80 ${y} L ${CANVAS_W + 80} ${y}`} />;
            })}
            {[-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((lane) => (
              <path key={lane} d={`M 600 ${FLOOR_HORIZON_Y} L ${600 + lane * 250} ${CANVAS_H}`} />
            ))}
          </g>

          <g transform={`translate(${CANVAS_W / 2} ${CANVAS_H}) scale(${camera.scale}) translate(${-CANVAS_W / 2} ${-CANVAS_H})`}>
          <g className="constellation-edges" aria-hidden>
            {[...scene.nodes.values()].flatMap((node) =>
              node.commit.parents.map((parentHash, parentIndex) => {
                const parent = scene.nodes.get(parentHash);
                if (!parent) return null;
                // Forks remain attached to the centre line, but sibling
                // branches depart a few moments before/after one another.
                // This is a time offset along the shared rail, not a sideways
                // elbow, so the tube stays continuous and smooth.
                const railOffset = !node.trunk && parent.trunk
                  ? scene.railOffsets.get(`${node.commit.hash}:${parentHash}`) ?? 0
                  : 0;
                const end = parent.trunk && railOffset !== 0
                  ? { x: parent.x, y: parent.y + railOffset * parent.scale }
                  : parent;
                const dx = end.x - node.x;
                const path = `M ${node.x} ${node.y} C ${node.x + dx * 0.14} ${node.y - 46 * node.scale}, ${end.x - dx * 0.14} ${end.y + 36 * parent.scale}, ${end.x} ${end.y}`;
                const className = `${node.trunk ? "trunk" : "branch"}${node.elevation > 0 ? " elevated" : ""}`;
                return [
                  <path
                    key={`${node.commit.hash}-${parentHash}-${parentIndex}-depth`}
                    d={path}
                    style={{ stroke: node.colour }}
                    className={`${className} constellation-edge-depth`}
                  />,
                  <path
                    key={`${node.commit.hash}-${parentHash}-${parentIndex}`}
                    d={path}
                    style={{ stroke: node.colour, opacity: node.trunk ? 0.9 : 0.72 }}
                    className={className}
                  />,
                ];
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
                  style={{ opacity: node.current || active ? 1 : (node.trunk ? 0.72 : 0.48) + node.scale * 0.28 }}
                  role="button"
                  tabIndex={node.index === cursor ? 0 : -1}
                  onClick={() => {
                    if (!panned.current) setInspectedHash(node.commit.hash);
                  }}
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
              // Labels step away from nearby endpoints rather than sitting on
              // the same plane as the node they explain.
              const labelOffset = 28 + Math.floor(index / 2) * 9;
              const y = node.y + (index % 2 === 0 ? -labelOffset : labelOffset) * node.scale;
              const tone = entry.isCurrent ? "current" : dirty ? "dirty" : merged ? "merged" : "open";
              return (
                <g
                  key={entry.path}
                  className={`constellation-folder ${tone}`}
                  transform={`translate(${x} ${y}) scale(${node.scale})`}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (!panned.current) setInspectedHash(node.commit.hash);
                  }}
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
          </g>
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
