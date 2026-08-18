import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ExternalLink, Maximize2, Minimize2, RotateCcw, X } from "lucide-react";
import type { BranchEntry, CommitEntry, WorktreeEntry } from "../types";
import {
  buildGraphScene,
  TRUNK_COLOUR,
  type SceneCommit,
  type SceneTip,
} from "../lib/graphScene";

type GraphViewProps = {
  /** Multi-branch history, newest first. */
  commits: CommitEntry[];
  headHash?: string;
  selectedHash?: string;
  /** Retained while tag controls stay owned by the Home timeline. */
  unpushedTags?: Set<string>;
  branches?: BranchEntry[];
  worktrees?: WorktreeEntry[];
  onSelect: (commit: CommitEntry) => void;
  /** Opens a different checkout; it never checks a branch out over this one. */
  onOpenWorktree?: (path: string) => void;
  /** Switches this folder to a branch. Uncommitted work comes along. */
  onSwitchBranch?: (branch: string) => void;
  focused?: boolean;
  onFocusedChange?: (focused: boolean) => void;
};

// ---- World → screen -----------------------------------------------------
//
// History is a rail you look along. "Now" is at the bottom of the view, close
// to you and drawn large; the past runs away from you into a vanishing point
// near the top. The trunk is the centre rail, straight into that point; every
// other line of work sits in a lane beside it, converging with it in the
// distance. Travelling moves you along the rail, so the far, compressed past
// comes forward and opens up as you go back.
const NEAR_ROW_PX = 46; // least spacing between the two nearest rows, at zoom 1
const MAX_NEAR_ROW_PX = 74; // most, when a short history is spread to fill the tunnel
const LANE_W = 200; // lane spacing at the near plane
const ELEVATION = 40; // how far floating work is lifted off the floor, at the near plane
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.6;
const DEFAULT_ZOOM = 1;
const MAX_SCENE_COMMITS = 100;
const CHIP_MIN_DEPTH = 0.4; // below this scale a chip is unreadable, so it is not drawn

type Camera = { travel: number; pan: number; zoom: number };
type PointerPosition = { x: number; y: number };
type Projected = { x: number; y: number; floor: number; s: number; d: number };

const HOME_CAMERA: Camera = { travel: 0, pan: 0, zoom: DEFAULT_ZOOM };

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function pointerDistance(points: PointerPosition[]) {
  return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

type Projector = {
  vpX: number;
  vpY: number;
  nearY: number;
  /// Depth scale for a row: 1 at the near plane, → 0 at the horizon.
  scale: (row: number) => number;
  project: (row: number, lane: number, elevation: number) => Projected;
};

function makeProjector(width: number, height: number, camera: Camera, rowCount: number): Projector {
  const vpX = width / 2 + camera.pan;
  const vpY = Math.round(height * 0.15);
  const nearY = height - 96;
  const span = nearY - vpY;
  // How fast rows recede. A short history is spread out so it fills the
  // tunnel; a long one is packed so that forty-odd commits are in view before
  // the rest converges. Zoom is focal length on top of that: zooming in
  // spreads the rows out (fewer, larger), zooming out packs more in.
  const reach = Math.max(1, Math.min(rowCount - 1, 40));
  const natural = Math.min(MAX_NEAR_ROW_PX / span, Math.max(NEAR_ROW_PX / span, 3 / reach));
  const k = natural / camera.zoom;
  const scale = (row: number) => 1 / (1 + k * Math.max(row - camera.travel, -0.9 / k));
  return {
    vpX,
    vpY,
    nearY,
    scale,
    project: (row, lane, elevation) => {
      const d = row - camera.travel;
      const s = scale(row);
      const floor = vpY + span * s;
      return { x: vpX + lane * LANE_W * s, y: floor - elevation * ELEVATION * s, floor, s, d };
    },
  };
}

/// Curve between two commits. Same lane: straight. Different lanes: leaves and
/// arrives along the rail, so a fork peels off the trunk and a merge settles
/// back onto it rather than cutting across as a diagonal.
function edgePath(from: { x: number; y: number }, to: { x: number; y: number }) {
  if (Math.abs(from.x - to.x) < 0.5) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  const k = Math.max(10, Math.abs(to.y - from.y) * 0.5);
  return `M ${from.x} ${from.y} C ${from.x} ${from.y - k}, ${to.x} ${to.y + k}, ${to.x} ${to.y}`;
}

function tipLabel(tip: SceneTip, headBranch: string | null) {
  if (tip.worktree?.branch && tip.branches.includes(tip.worktree.branch)) return tip.worktree.branch;
  if (headBranch && tip.branches.includes(headBranch)) return headBranch;
  if (tip.branches.length > 0) return tip.branches[0];
  if (tip.worktree?.detached) return `detached at ${tip.hash.slice(0, 7)}`;
  if (tip.remotes.length > 0) return tip.remotes[0];
  if (tip.tags.length > 0) return tip.tags[0];
  return tip.hash.slice(0, 7);
}

function tipState(tip: SceneTip, entry: SceneCommit, trunkName: string) {
  const folder = tip.worktree;
  if (folder?.isCurrent) {
    const changes = folder.changeCount ?? 0;
    return changes > 0 ? `open here · ${changes} uncommitted ${changes === 1 ? "change" : "changes"}` : "open here";
  }
  if (folder) {
    const changes = folder.changeCount ?? 0;
    if (changes > 0) return `${changes} uncommitted ${changes === 1 ? "change" : "changes"} · other folder`;
    return "open in another folder";
  }
  if (tip.isTrunkTip) return "trunk";
  if (entry.trunk) return `on ${trunkName}`;
  if (tip.branches.length === 0 && tip.remotes.length > 0) {
    const remote = tip.remotes[0].split("/")[0];
    return `on ${remote}`;
  }
  const strand = entry.strand;
  if (!strand) return "";
  if (!strand.floating) return `merged into ${trunkName}`;
  const ahead = strand.hashes.length;
  return `${ahead} ${ahead === 1 ? "commit" : "commits"} ahead of ${trunkName}`;
}

/**
 * The repository as a rail you look along, not a ledger you scroll.
 *
 * `main` is the straight centre rail running into the distance. Every other
 * line of work sits in a lane beside it: a merged branch lies on the floor and
 * curves back in, an open branch floats above it and ends in a chip you can
 * switch to. Scrolling travels you back and forward in time.
 */
export function GraphView({
  commits,
  headHash,
  selectedHash,
  branches = [],
  worktrees = [],
  onSelect,
  onOpenWorktree,
  onSwitchBranch,
  focused = false,
  onFocusedChange,
}: GraphViewProps) {
  const [inspectedHash, setInspectedHash] = useState(selectedHash ?? "");
  const [camera, setCamera] = useState<Camera>(HOME_CAMERA);
  const [viewport, setViewport] = useState({ width: 900, height: 560 });
  const cameraRef = useRef(camera);
  const activePointers = useRef(new Map<number, PointerPosition>());
  const panStart = useRef<{ pointer: PointerPosition; camera: Camera } | null>(null);
  const pinchStart = useRef<{ distance: number; camera: Camera } | null>(null);
  const panned = useRef(false);
  const rowCountRef = useRef(0);
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

  // Smooth motion: wheel and zoom set a target and the camera eases toward
  // it, so a notched mouse wheel glides instead of jumping. Drags and pinches
  // set the camera directly (the pointer already is the easing).
  const targetRef = useRef<Camera>(HOME_CAMERA);
  const animationRef = useRef<number | null>(null);
  const settleCamera = useCallback(() => {
    animationRef.current = null;
    const target = targetRef.current;
    const current = cameraRef.current;
    const next: Camera = {
      travel: current.travel + (target.travel - current.travel) * 0.22,
      pan: current.pan + (target.pan - current.pan) * 0.22,
      zoom: current.zoom + (target.zoom - current.zoom) * 0.22,
    };
    const done = Math.abs(target.travel - next.travel) < 0.002
      && Math.abs(target.pan - next.pan) < 0.2
      && Math.abs(target.zoom - next.zoom) < 0.001;
    updateCamera(done ? target : next);
    if (!done) animationRef.current = requestAnimationFrame(settleCamera);
  }, [updateCamera]);
  const glideTo = useCallback((next: Camera) => {
    const travel = Math.min(Math.max(next.travel, -1), Math.max(0, rowCountRef.current - 2));
    targetRef.current = { ...next, zoom: clampZoom(next.zoom), travel };
    if (animationRef.current === null) animationRef.current = requestAnimationFrame(settleCamera);
  }, [settleCamera]);
  const jumpTo = useCallback((next: Camera) => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    targetRef.current = next;
    updateCamera(next);
  }, [updateCamera]);
  useEffect(() => () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
  }, []);

  // The stage may not exist on first render (history still loading), so its
  // listeners are attached through a callback ref rather than a mount effect.
  const stageCleanup = useRef<(() => void) | null>(null);
  const attachStage = useCallback((element: HTMLDivElement | null) => {
    stageCleanup.current?.();
    stageCleanup.current = null;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0 && box.height > 0) {
        setViewport({ width: Math.round(box.width), height: Math.round(box.height) });
      }
    });
    observer.observe(element);

    // Wheel is attached natively and non-passively: React's synthetic wheel
    // listener is passive, so preventDefault there is ignored and the page
    // scrolls instead of the graph travelling.
    function moveThroughTime(event: globalThis.WheelEvent) {
      event.preventDefault();
      const target = targetRef.current;
      if (event.ctrlKey || event.metaKey) {
        glideTo({ ...target, zoom: target.zoom * Math.exp(-event.deltaY * 0.004) });
        return;
      }
      // Scrolling up — the way you reach older entries in any list — carries
      // you down the rail into the past; scrolling down brings you back to now.
      const step = event.deltaMode === 1 ? event.deltaY * 18 : event.deltaY;
      glideTo({
        ...target,
        travel: target.travel - step / 40,
        pan: target.pan - (event.deltaMode === 1 ? event.deltaX * 18 : event.deltaX),
      });
    }
    element.addEventListener("wheel", moveThroughTime, { passive: false });

    stageCleanup.current = () => {
      observer.disconnect();
      element.removeEventListener("wheel", moveThroughTime);
    };
  }, [glideTo]);

  const scene = useMemo(
    () => buildGraphScene(commits.slice(0, MAX_SCENE_COMMITS), { headHash, branches, worktrees }),
    [commits, headHash, branches, worktrees],
  );
  rowCountRef.current = scene.commits.length;

  const headBranch = useMemo(() => {
    const current = worktrees.find((entry) => entry.isCurrent)?.branch;
    if (current) return current;
    return branches.find((branch) => !branch.isRemote && branch.isCurrent)?.name ?? null;
  }, [branches, worktrees]);

  // ---- Screen positions ------------------------------------------------
  const { width, height } = viewport;
  const projector = useMemo(
    () => makeProjector(width, height, camera, scene.commits.length),
    [width, height, camera, scene.commits.length],
  );
  const positions = useMemo(() => {
    const map = new Map<string, Projected>();
    for (const entry of scene.commits) {
      map.set(entry.commit.hash, projector.project(entry.row, entry.lane, entry.elevation));
    }
    return map;
  }, [scene, projector]);
  // Anything behind the camera is not drawn.
  const visible = (point: Projected) => point.s < 6 && point.y < height + 80;

  const cursorIndex = Math.max(0, scene.commits.findIndex((entry) => entry.commit.hash === selectedHash));
  const inspected = scene.byHash.get(inspectedHash) ?? null;
  const inspectedTip = scene.tips.find((tip) => tip.hash === inspectedHash) ?? null;

  // ---- Chips -----------------------------------------------------------
  // A chip sits in the margin outside every lane that is busy around its
  // row, tethered to its commit, so it never lies across another line of
  // work. Chips shrink a little with distance and are dropped once too far
  // to read; chips on one side that would overlap are nudged apart, and one
  // that would have to move too far is dropped rather than mislabelling.
  const chips = useMemo(() => {
    type Chip = {
      tip: SceneTip;
      entry: SceneCommit;
      label: string;
      state: string;
      extra: number;
      side: -1 | 1;
      width: number;
      height: number;
      scale: number;
      x: number;
      y: number;
      anchor: Projected;
    };
    const laid: Chip[] = [];
    for (const tip of scene.tips) {
      if (!tip.labelled) continue;
      const entry = scene.byHash.get(tip.hash);
      const point = positions.get(tip.hash);
      if (!entry || !point) continue;
      if (point.s < CHIP_MIN_DEPTH || !visible(point)) continue;
      const label = tipLabel(tip, headBranch);
      const state = tipState(tip, entry, scene.trunkName);
      const extra = tip.branches.length + tip.remotes.length + tip.tags.length
        - (tip.branches.includes(label) || tip.remotes.includes(label) || tip.tags.includes(label) ? 1 : 0);
      const nameWidth = label.length * 7.4 + (extra > 0 ? 30 : 0);
      const chipWidth = Math.min(280, Math.max(120, Math.max(nameWidth, state.length * 6.1) + 24));
      const chipHeight = state ? 40 : 26;
      const chipScale = Math.max(0.74, Math.min(1, point.s));

      const busy = (side: -1 | 1) => {
        let outermost = 0;
        for (const strand of scene.strands) {
          if (Math.sign(strand.lane) !== side) continue;
          if (strand.minRow - 1 > entry.row || strand.maxRow + 1 < entry.row) continue;
          outermost = Math.max(outermost, Math.abs(strand.lane));
        }
        return outermost;
      };
      let side: -1 | 1;
      if (entry.lane !== 0) side = entry.lane < 0 ? -1 : 1;
      else {
        const left = busy(-1);
        const right = busy(1);
        side = left === right ? (tip.isTrunkTip ? 1 : -1) : left < right ? -1 : 1;
      }
      const outermost = Math.max(busy(side), Math.abs(entry.lane));
      const edgeX = projector.vpX + side * outermost * LANE_W * point.s;
      const halfWidth = (chipWidth * chipScale) / 2;
      // Keep the chip inside the view: it may sit over the far lanes rather
      // than be cut off at the edge.
      const x = Math.max(halfWidth + 6, Math.min(width - halfWidth - 6, edgeX + side * (16 + halfWidth)));
      laid.push({ tip, entry, label, state, extra, side, width: chipWidth, height: chipHeight, scale: chipScale, x, y: point.y, anchor: point });
    }
    const kept: Chip[] = [];
    for (const side of [-1, 1] as const) {
      // Nearest first: the chip closest to the viewer keeps its place and
      // farther ones make way, upward, toward the horizon.
      const column = laid.filter((chip) => chip.side === side).sort((a, b) => b.y - a.y);
      let previousTop = Infinity;
      for (const chip of column) {
        const half = (chip.height * chip.scale) / 2;
        const wanted = chip.y;
        if (chip.y + half > previousTop - 6) chip.y = previousTop - 6 - half;
        if (wanted - chip.y > 90) continue;
        previousTop = chip.y - half;
        kept.push(chip);
      }
    }
    return kept;
  }, [scene, positions, headBranch, projector, width]);

  // ---- Interaction -----------------------------------------------------
  function moveFocus(index: number, delta: number, element: SVGGElement) {
    const next = Math.max(0, Math.min(scene.commits.length - 1, index + delta));
    const graph = element.closest<SVGSVGElement>(".constellation-canvas");
    graph?.querySelectorAll<SVGGElement>(".constellation-commit")[next]?.focus();
  }

  function commitKeyDown(event: ReactKeyboardEvent<SVGGElement>, entry: SceneCommit) {
    const delta = event.key === "ArrowUp" || event.key === "ArrowLeft" ? 1
      : event.key === "ArrowDown" || event.key === "ArrowRight" ? -1
        : 0;
    if (delta !== 0) {
      event.preventDefault();
      event.stopPropagation();
      moveFocus(entry.row, delta, event.currentTarget);
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setInspectedHash(entry.commit.hash);
    }
  }

  function beginGesture(event: ReactPointerEvent<SVGSVGElement>) {
    // Capture is taken only once this turns into a drag: capturing here would
    // make the browser deliver the eventual click to the SVG instead of the
    // commit or chip under the pointer.
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = [...activePointers.current.values()];
    if (pointers.length === 1) {
      panStart.current = { pointer: pointers[0], camera: cameraRef.current };
      pinchStart.current = null;
    } else if (pointers.length === 2) {
      pinchStart.current = { distance: pointerDistance(pointers), camera: cameraRef.current };
      panStart.current = null;
    }
  }

  function moveGesture(event: ReactPointerEvent<SVGSVGElement>) {
    if (!activePointers.current.has(event.pointerId)) return;
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = [...activePointers.current.values()];
    if (pointers.length >= 2 && pinchStart.current) {
      const zoom = clampZoom(
        pinchStart.current.camera.zoom * (pointerDistance(pointers) / pinchStart.current.distance),
      );
      if (Math.abs(zoom - cameraRef.current.zoom) > 0.01) {
        panned.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      jumpTo({ ...pinchStart.current.camera, zoom });
      return;
    }
    if (pointers.length === 1 && panStart.current) {
      const dx = pointers[0].x - panStart.current.pointer.x;
      const dy = pointers[0].y - panStart.current.pointer.y;
      if (Math.hypot(dx, dy) > 3) {
        panned.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      } else if (!panned.current) {
        return;
      }
      const start = panStart.current.camera;
      // Dragging down pulls the distant past toward you.
      jumpTo({
        ...start,
        travel: Math.min(Math.max(start.travel + dy / NEAR_ROW_PX, -1), Math.max(0, rowCountRef.current - 2)),
        pan: start.pan + dx,
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

  if (scene.commits.length === 0) {
    return <div className="constellation-empty">No history to draw yet.</div>;
  }

  // ---- Floor -----------------------------------------------------------
  const { vpX, vpY, nearY } = projector;
  const oldestRow = scene.commits.length - 1;
  const railLanes = Math.max(scene.lanesLeft, scene.lanesRight, 2) + 3;
  const rungRows: number[] = [];
  for (let row = Math.floor(camera.travel) - 1; row <= oldestRow + 40; row += 1) {
    const s = projector.scale(row);
    if (s < 0.06) break;
    if (vpY + (nearY - vpY) * s > height + 40) continue;
    rungRows.push(row);
  }

  // Day markers along the left edge, so travel has a sense of when.
  const dayMarkers: Array<{ y: number; label: string; s: number }> = [];
  let lastDay = "";
  let lastY = Infinity;
  for (const entry of scene.commits) {
    const date = new Date(entry.commit.date);
    if (Number.isNaN(date.getTime())) continue;
    const point = positions.get(entry.commit.hash)!;
    if (!visible(point) || point.s < 0.28) continue;
    const day = date.toDateString();
    if (day === lastDay || lastY - point.floor < 18) continue;
    lastDay = day;
    lastY = point.floor;
    dayMarkers.push({
      y: point.floor,
      s: point.s,
      label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    });
  }

  const inspectedLabel = inspectedTip ? tipLabel(inspectedTip, headBranch) : "";
  const inspectedSwitchable = inspectedTip
    && !inspectedTip.worktree
    && inspectedTip.branches.length > 0
    && !(inspectedTip.isHead && inspectedTip.branches.includes(headBranch ?? ""))
    ? inspectedLabel
    : null;

  const oldestTrunk = [...scene.trunkHashes].map((hash) => scene.byHash.get(hash)!).sort((a, b) => b.row - a.row)[0];

  return (
    <section className={`constellation-view${focused ? " focused" : ""}`} aria-label="Repository map">
      <div className="constellation-stage" ref={attachStage}>
        <div className="constellation-controls" aria-label="Graph view controls">
          <button
            type="button"
            className="constellation-control"
            onClick={() => glideTo(HOME_CAMERA)}
            title="Back to now"
            aria-label="Back to now: reset time position and zoom"
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
          Scroll or drag to travel through time · pinch or Ctrl+scroll to zoom
        </p>
        <svg
          className="constellation-canvas"
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-label={`A map of branches around ${scene.trunkName}: merged branches curve back into it, open branches float beside it`}
          onPointerDown={beginGesture}
          onPointerMove={moveGesture}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
        >
          <defs>
            <radialGradient id="constellation-horizon-glow" cx={vpX / width} cy={vpY / height} r="0.55">
              <stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="0.5" stopColor="var(--accent)" stopOpacity="0.05" />
              <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="constellation-floor-shade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--text)" stopOpacity="0" />
              <stop offset="1" stopColor="var(--text)" stopOpacity="0.07" />
            </linearGradient>
            <linearGradient id="constellation-now-fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--bg-base)" stopOpacity="0" />
              <stop offset="1" stopColor="var(--bg-base)" stopOpacity="1" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width={width} height={height} fill="url(#constellation-horizon-glow)" />

          <g className="constellation-floor" aria-hidden>
            {/* The floor: a plane running from the near edge into the vanishing point. */}
            <path
              className="plane"
              d={`M ${vpX} ${vpY} L ${vpX + railLanes * LANE_W * 2.4} ${height + 40} L ${vpX - railLanes * LANE_W * 2.4} ${height + 40} Z`}
              fill="url(#constellation-floor-shade)"
            />
            {rungRows.map((row) => {
              const s = projector.scale(row);
              const y = vpY + (nearY - vpY) * s;
              const half = railLanes * LANE_W * s;
              return (
                <path
                  key={`rung-${row}`}
                  className={row % 5 === 0 ? "major" : undefined}
                  d={`M ${vpX - half} ${y} L ${vpX + half} ${y}`}
                  style={{ opacity: 0.05 + 0.16 * s }}
                />
              );
            })}
            {Array.from({ length: railLanes * 2 + 1 }, (_, index) => index - railLanes).map((lane) => {
              const far = 2.4;
              return (
                <path
                  key={`rail-${lane}`}
                  className={lane === 0 ? "trunk-rail" : undefined}
                  d={`M ${vpX} ${vpY} L ${vpX + lane * LANE_W * far} ${vpY + (nearY - vpY) * far}`}
                />
              );
            })}
          </g>

          {/* A time ruler down the left edge: which day each row belongs to. */}
          <g className="constellation-day-markers" aria-hidden>
            {dayMarkers.map((marker) => (
              <g key={`${marker.label}-${marker.y}`} transform={`translate(14 ${marker.y})`} style={{ opacity: 0.35 + 0.65 * marker.s }}>
                <line x1="0" y1="0" x2="10" y2="0" />
                <text x="14" y="3.5">{marker.label}</text>
              </g>
            ))}
          </g>

          {/* Floating work casts a shadow onto the floor: a faint copy of the
              line where it would lie if it were merged. */}
          <g className="constellation-shadows" aria-hidden>
            {scene.strands.filter((strand) => strand.floating).map((strand) => {
              const points = strand.hashes
                .map((hash) => positions.get(hash))
                .filter((point): point is Projected => !!point && visible(point));
              if (points.length === 0) return null;
              const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.floor}`).join(" ");
              return (
                <g key={strand.id}>
                  <path d={path} />
                  {points.map((point, index) => (
                    <ellipse key={index} cx={point.x} cy={point.floor} rx={7 * point.s} ry={2.6 * point.s} />
                  ))}
                </g>
              );
            })}
          </g>

          <g className="constellation-edges" aria-hidden>
            {/* The trunk runs on into the vanishing point beyond what is loaded. */}
            {oldestTrunk && oldestTrunk.commit.parents.length === 0 ? (() => {
              const point = positions.get(oldestTrunk.commit.hash)!;
              return <path className="stub trunk" d={`M ${point.x} ${point.y} L ${vpX} ${vpY}`} style={{ stroke: TRUNK_COLOUR, strokeWidth: 3 * point.s }} />;
            })() : null}
            {scene.commits.flatMap((entry) => {
              const from = positions.get(entry.commit.hash)!;
              if (!visible(from)) return [];
              return entry.commit.parents.flatMap((parentHash, parentIndex) => {
                const parent = scene.byHash.get(parentHash);
                const to = positions.get(parentHash);
                if (!parent || !to) {
                  // History continues past the window: fade out a stub.
                  if (parentIndex > 0) return [];
                  const beyond = projector.project(entry.row + 1.2, entry.lane, entry.elevation);
                  return [
                    <path
                      key={`${entry.commit.hash}-stub`}
                      className={`stub${entry.trunk ? " trunk" : ""}`}
                      d={`M ${from.x} ${from.y} L ${beyond.x} ${beyond.y}`}
                      style={{ stroke: entry.colour, strokeWidth: (entry.trunk ? 4 : 2.4) * from.s }}
                    />,
                  ];
                }
                // A merge's incoming side belongs to the line being merged,
                // so it keeps that line's colour: the branch returns.
                const incoming = parentIndex > 0;
                const owner = incoming ? parent : entry;
                // Bringing the trunk *into* a branch (an update) is
                // bookkeeping, not a story beat: thin and quiet.
                const update = incoming && parent.trunk && !entry.trunk;
                const className = [
                  owner.trunk ? "trunk" : "branch",
                  update ? "update" : "",
                  owner.elevation > 0 ? "floating" : "",
                ].filter(Boolean).join(" ");
                const d = edgePath(from, to);
                const depth = (from.s + to.s) / 2;
                const strokeWidth = (owner.trunk ? 4.2 : update ? 1.6 : 2.6) * Math.max(0.35, depth);
                const opacity = update ? 0.35 : 0.45 + 0.55 * Math.min(1, depth);
                return [
                  update ? null : (
                    <path
                      key={`${entry.commit.hash}-${parentHash}-body`}
                      className={`${className} body`}
                      d={d}
                      style={{ stroke: owner.colour, strokeWidth: strokeWidth * 3 }}
                    />
                  ),
                  <path
                    key={`${entry.commit.hash}-${parentHash}`}
                    className={className}
                    d={d}
                    style={{ stroke: owner.colour, strokeWidth, opacity }}
                  />,
                ];
              });
            })}
          </g>

          <g className="constellation-nodes">
            {[...scene.commits].reverse().map((entry) => {
              const point = positions.get(entry.commit.hash)!;
              if (!visible(point)) return null;
              const isHead = entry.commit.hash === headHash;
              const active = entry.commit.hash === selectedHash || entry.commit.hash === inspectedHash;
              const merge = entry.commit.parents.length > 1;
              const radius = (entry.trunk ? 6.5 : 5.5) * Math.max(0.3, point.s);
              return (
                <g
                  key={entry.commit.hash}
                  className={`constellation-commit${entry.trunk ? " trunk" : ""}${entry.elevation > 0 ? " floating" : ""}${isHead ? " current" : ""}${active ? " active" : ""}`}
                  transform={`translate(${point.x} ${point.y})`}
                  style={{ opacity: 0.4 + 0.6 * Math.min(1, point.s) }}
                  role="button"
                  tabIndex={entry.row === cursorIndex ? 0 : -1}
                  onClick={() => {
                    if (!panned.current) setInspectedHash(entry.commit.hash);
                  }}
                  onDoubleClick={() => {
                    if (!panned.current) onSelect(entry.commit);
                  }}
                  onKeyDown={(event) => commitKeyDown(event, entry)}
                >
                  <title>{`${entry.commit.shortHash} · ${entry.commit.subject}`}</title>
                  {entry.elevation > 0 ? (
                    <line className="constellation-stem" x1="0" y1={radius} x2="0" y2={point.floor - point.y} />
                  ) : null}
                  {isHead ? <circle r={radius + 7 * point.s} className="constellation-current-ring" /> : null}
                  <circle r={radius} style={{ fill: entry.colour, stroke: entry.colour, strokeWidth: 2 * Math.max(0.5, point.s) }} />
                  {merge ? <circle r={radius * 0.42} className="constellation-merge-mark" /> : null}
                </g>
              );
            })}
          </g>

          <g className="constellation-tips">
            {chips.map(({ tip, entry, label, state, extra, side, width: chipWidth, height: chipHeight, scale: chipScale, x, y, anchor }) => {
              const folder = tip.worktree;
              const dirty = (folder?.changeCount ?? 0) > 0;
              const remoteOnly = tip.branches.length === 0 && !folder && tip.remotes.length > 0;
              const tone = folder?.isCurrent || (tip.isHead && !folder) ? "current"
                : dirty ? "dirty"
                  : remoteOnly ? "remote"
                    : tip.isTrunkTip ? "trunk"
                      : entry.trunk || (entry.strand && !entry.strand.floating) ? "merged"
                        : "open";
              const switchable = !folder && tip.branches.length > 0 && !(tip.isHead && tip.branches.includes(headBranch ?? ""));
              const hint = folder?.isCurrent
                ? `${label} is open here`
                : folder
                  ? `Double-click to open ${label}'s folder`
                  : switchable
                    ? `Double-click to switch to ${label}`
                    : label;
              const nearEdgeX = x - side * (chipWidth * chipScale) / 2;
              return (
                <g
                  key={tip.hash}
                  className={`constellation-folder ${tone}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (!panned.current) setInspectedHash(tip.hash);
                  }}
                  onDoubleClick={() => {
                    if (panned.current) return;
                    if (folder && !folder.isCurrent) onOpenWorktree?.(folder.path);
                    else if (switchable) onSwitchBranch?.(label);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setInspectedHash(tip.hash);
                    }
                  }}
                >
                  <title>{hint}</title>
                  <path
                    className="constellation-tip-tether"
                    d={`M ${anchor.x + side * 9 * anchor.s} ${anchor.y} C ${(anchor.x + nearEdgeX) / 2} ${anchor.y}, ${(anchor.x + nearEdgeX) / 2} ${y}, ${nearEdgeX} ${y}`}
                  />
                  <g transform={`translate(${x} ${y}) scale(${chipScale})`}>
                    <rect x={-chipWidth / 2} y={-chipHeight / 2} width={chipWidth} height={chipHeight} rx="7" />
                    {dirty ? <circle cx={-chipWidth / 2 + 12} cy={state ? -8 : 0} r="4" /> : null}
                    <text
                      className="constellation-folder-name"
                      x={-chipWidth / 2 + (dirty ? 22 : 11)}
                      y={state ? -3 : 4}
                    >
                      {label}
                      {extra > 0 ? <tspan className="constellation-folder-extra">{` +${extra}`}</tspan> : null}
                    </text>
                    {state ? (
                      <text className="constellation-folder-state" x={-chipWidth / 2 + 11} y="12">
                        {state}
                      </text>
                    ) : null}
                  </g>
                </g>
              );
            })}
          </g>

          {/* The bottom edge grounds "now". */}
          <rect className="constellation-fade" x="0" y={height - 44} width={width} height="44" fill="url(#constellation-now-fade)" />
          <text className="constellation-trunk-caption" x={vpX} y={height - 14} textAnchor="middle">
            {scene.trunkName} · trunk
          </text>
          {camera.travel > 0.5 ? (
            <text className="constellation-edge-caption" x={vpX} y={height - 30} textAnchor="middle">
              {`${Math.round(camera.travel)} ${Math.round(camera.travel) === 1 ? "commit" : "commits"} back · press ↺ for now`}
            </text>
          ) : null}
        </svg>
        {inspected ? (
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
              {inspectedTip ? (inspectedTip.worktree ? "Folder" : "Branch tip") : inspected.trunk ? `On ${scene.trunkName}` : "Commit"}
            </p>
            <h3>{inspectedTip ? inspectedLabel : inspected.commit.subject}</h3>
            {inspectedTip ? (
              <p className="constellation-inspector-state">{tipState(inspectedTip, inspected, scene.trunkName)}</p>
            ) : null}
            {inspectedTip ? <p className="constellation-inspector-subject">{inspected.commit.subject}</p> : null}
            <dl>
              <dt>Commit</dt><dd><code>{inspected.commit.shortHash}</code></dd>
              <dt>Author</dt><dd>{inspected.commit.author}</dd>
              <dt>When</dt><dd>{new Date(inspected.commit.date).toLocaleString()}</dd>
              {inspectedTip && (inspectedTip.branches.length + inspectedTip.remotes.length + inspectedTip.tags.length) > 1 ? (
                <>
                  <dt>Also here</dt>
                  <dd>
                    {[
                      ...inspectedTip.branches.filter((name) => name !== inspectedLabel),
                      ...inspectedTip.remotes.filter((name) => name !== inspectedLabel),
                      ...inspectedTip.tags.filter((name) => name !== inspectedLabel).map((tag) => `tag ${tag}`),
                    ].join(", ")}
                  </dd>
                </>
              ) : null}
            </dl>
            <div className="constellation-inspector-actions">
              {inspectedTip?.worktree && !inspectedTip.worktree.isCurrent && onOpenWorktree ? (
                <button
                  type="button"
                  className="constellation-inspector-open"
                  onClick={() => onOpenWorktree(inspectedTip.worktree!.path)}
                >
                  Open this folder
                </button>
              ) : null}
              {inspectedSwitchable && onSwitchBranch ? (
                <button
                  type="button"
                  className="constellation-inspector-open"
                  onClick={() => onSwitchBranch(inspectedSwitchable)}
                >
                  Switch to {inspectedSwitchable}
                </button>
              ) : null}
              <button type="button" className="constellation-inspector-detail" onClick={() => onSelect(inspected.commit)}>
                <ExternalLink size={13} /> View files and diff
              </button>
            </div>
            {inspectedSwitchable && onSwitchBranch ? (
              <p className="constellation-inspector-note">
                Your uncommitted changes come along; what you committed on {headBranch ?? "this branch"} stays here to come back to.
              </p>
            ) : null}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
