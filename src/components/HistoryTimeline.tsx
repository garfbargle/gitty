import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FolderOpen, GitBranch } from "lucide-react";
import type { BranchDivergence, CommitEntry, SiblingTip, WorktreeEntry } from "../types";
import {
  aheadTimelineCommits,
  ancestryTimelineCommits,
  unpushedTimeline,
} from "../lib/commitDisplay";
import { buildCommitTagMenuItems } from "../lib/commitTags";
import { laneColor } from "../lib/graph";
import {
  formatDate,
  formatRelativeTime,
  folderName,
  relativeTimeRefreshMs,
  remoteFreshness,
  tagName,
  tagRefs,
} from "../lib/git";
import { usePriorityPlus } from "../lib/usePriorityPlus";
import { useLongPress, type LongPressPoint } from "../lib/useLongPress";
import { ContextMenu } from "./ContextMenu";
import { TagBadge } from "./TagBadge";

const SCROLL_END_THRESHOLD = 24;

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
  onBranchFrom?: (commit: CommitEntry) => void;
  onResetTo?: (commit: CommitEntry) => void;
  workingTreeActive?: boolean;
  /// Where the checked-out branch sits relative to the trunk and its upstream.
  contextLanes?: BranchDivergence[];
  /// The most recently active other branch, shown as a single awareness chip.
  siblingTip?: SiblingTip | null;
  /// Switch to the sibling branch.
  onSwitchSibling?: (name: string) => void;
  /// The two moves against the trunk: rebase your branch onto it, or merge in.
  canUpdateFromMain?: boolean;
  canMergeIntoMain?: boolean;
  integrationBusy?: boolean;
  onUpdateFromMain?: () => void;
  onMergeIntoMain?: () => void;
  /// When the remote was last actually reached. Only the remote chip uses it:
  /// a trunk branch is local, so it is never stale.
  lastFetchedAt?: number | null;
  /// The branch checked out in this folder, so the row can say where you are.
  currentBranch?: string;
  /// Other checkouts of this repository. Nothing else on this screen mentions
  /// them, so without these the row cannot answer "is this the only folder".
  worktrees?: WorktreeEntry[];
  onOpenCheckout?: (path: string) => void;
  /// Commits the remote does not have. The push button reported a count and
  /// nothing said which commits it meant, so the number had to be taken on
  /// trust; these let the strip mark them and draw the line.
  unpushedCommits?: string[];
  historyView?: "strip" | "graph";
  onHistoryViewChange?: (view: "strip" | "graph") => void;
  /// Viewing a past commit rather than the working tree. The actions for
  /// leaving that state live here rather than in the top bar: they only exist
  /// while a commit is selected, and the top bar has no spare room to gain and
  /// lose a pair of buttons every time the selection changes.
  inPreview?: boolean;
  onOpenVersion?: () => void;
  onReturnToWorkingTree?: () => void;
  /// A live integration op, drawn as a preview node on the track.
  integrationPreview?: {
    kind: "update" | "merge";
    branch: string;
    onto: string;
    done: boolean;
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
  onBranchFrom,
  onResetTo,
  workingTreeActive,
  contextLanes = [],
  siblingTip,
  onSwitchSibling,
  canUpdateFromMain,
  canMergeIntoMain,
  integrationBusy,
  onUpdateFromMain,
  onMergeIntoMain,
  lastFetchedAt,
  currentBranch,
  worktrees = [],
  onOpenCheckout,
  unpushedCommits,
  historyView = "strip",
  onHistoryViewChange,
  inPreview,
  onOpenVersion,
  onReturnToWorkingTree,
  integrationPreview,
}: HistoryTimelineProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ReturnType<typeof buildCommitTagMenuItems>;
  } | null>(null);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  // Branch-from, reset-to and the tag actions live only in this menu, which
  // until now opened only on right-click.
  const bindLongPress = useLongPress();
  const tagActionsEnabled = !!(onCreateTag && onDeleteTag);
  const ancestry = useMemo(() => ancestryTimelineCommits(commits), [commits]);
  const ahead = useMemo(() => aheadTimelineCommits(aheadCommits), [aheadCommits]);
  const commitDates = useMemo(
    () => [...ancestry, ...ahead].map((commit) => commit.date),
    [ancestry, ahead],
  );
  const [now, setNow] = useState(() => Date.now());

  // Which commits the remote does not have, where the line between pushed and
  // unpushed falls, and how far along the run each one sits.
  const unpushedSet = useMemo(() => new Set(unpushedCommits ?? []), [unpushedCommits]);
  const { oldestUnpushed: oldestUnpushedInView, order: unpushedOrder } = useMemo(
    () => unpushedTimeline(ancestry, unpushedSet),
    [ancestry, unpushedSet],
  );

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
  const scrollFrameRef = useRef<number | null>(null);
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

  /// Where the push boundary sits in track coordinates.
  ///
  /// The label used to live inside the boundary node, so it left the screen
  /// with the commit it marks — which is most of the time, since the strip
  /// opens at the present and the run can be long. It now sits in a band that
  /// spans from the boundary to the end of the track, and sticks to the left
  /// edge while any of that band is in view.
  const [boundaryX, setBoundaryX] = useState<number | null>(null);

  const measureBoundary = useCallback(() => {
    const node = oldestUnpushedInView ? nodeRefs.current.get(oldestUnpushedInView) : undefined;
    const next = node ? node.offsetLeft : null;
    setBoundaryX((prev) => (prev === next ? prev : next));
  }, [oldestUnpushedInView]);

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

  const isScrolledToEnd = useCallback((): boolean => {
    const container = scrollRef.current;
    if (!container) return true;
    const remaining = container.scrollWidth - container.clientWidth - container.scrollLeft;
    return remaining <= SCROLL_END_THRESHOLD;
  }, []);

  /// Bring the selected commit into view, centred, when it is not already
  /// visible.
  ///
  /// It used to nudge the node just far enough to clear the edge, which put the
  /// commit you had just moved to against the boundary with no history visible
  /// on the side you were travelling toward — so arrowing through history
  /// scrolled one node at a time and you never saw what was coming. Centring
  /// gives context in both directions.
  ///
  /// A node already fully in view is left alone: re-centring on every selection
  /// would drag the strip under the pointer while clicking along it.
  const scrollNodeIntoView = useCallback((node: HTMLButtonElement | undefined) => {
    const container = scrollRef.current;
    if (!container || !node) return;

    const padding = 16;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();

    const fullyVisible =
      nodeRect.left >= containerRect.left + padding &&
      nodeRect.right <= containerRect.right - padding;
    if (fullyVisible) return;

    // Node centre in scroll coordinates, then the offset that puts it mid-band.
    const nodeCentre =
      nodeRect.left - containerRect.left + container.scrollLeft + nodeRect.width / 2;
    const furthest = container.scrollWidth - container.clientWidth;
    const left = Math.max(0, Math.min(furthest, nodeCentre - container.clientWidth / 2));

    // Native smoothing rather than an animation loop: one call, interruptible
    // by the user's own scroll, and nothing to clean up. Honoured against the
    // motion preference, which the browser does not do for us here.
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    container.scrollTo({ left, behavior: reduceMotion ? "auto" : "smooth" });
  }, []);

  const applyScrollPosition = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    // A selected commit wins over staying pinned to the present. This used to
    // test pinnedToEnd first, so selecting a commit while parked at the right
    // edge -- the default, and where you are after every refresh -- snapped
    // back to the end instead of going to what you had just chosen. The pin
    // exists to keep Now in view as commits arrive, not to override the
    // selection.
    if (workingTreeActive || !selectedHash) {
      pinnedToEndRef.current = true;
      container.scrollLeft = container.scrollWidth - container.clientWidth;
      return;
    }

    pinnedToEndRef.current = false;
    scrollNodeIntoView(nodeRefs.current.get(selectedHash));
  }, [selectedHash, scrollNodeIntoView, workingTreeActive]);

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
  }, [isScrolledToEnd]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    // Vertical wheel scrolls the strip horizontally; a genuinely horizontal
    // gesture is left to the browser.
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      container.scrollLeft += event.deltaY;
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", onWheel);
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    scheduleApplyScrollPosition();
  }, [headHash, selectedHash, workingTreeActive, ancestry.length, ahead.length, scheduleApplyScrollPosition]);

  useLayoutEffect(() => {
    measureLanes();
    measureBoundary();
  }, [
    measureLanes,
    measureBoundary,
    headHash,
    ancestry.length,
    ahead.length,
    changeCount,
    !!integrationPreview,
  ]);

  useLayoutEffect(() => {
    const container = scrollRef.current;
    const track = container?.querySelector(".timeline-track");
    if (!container) return;

    const observer = new ResizeObserver(() => {
      scheduleApplyScrollPosition();
      measureLanes();
      measureBoundary();
    });

    observer.observe(container);
    if (track) observer.observe(track);

    return () => observer.disconnect();
  }, [scheduleApplyScrollPosition, measureLanes, measureBoundary]);

  function selectCommit(commit: CommitEntry) {
    onInteract?.();
    onSelect(commit);
  }

  function selectWorkingTree() {
    onInteract?.();
    onSelectWorkingTree();
  }

  function openTagContextMenu(point: LongPressPoint, commit: CommitEntry) {
    setContextMenu({
      x: point.x,
      y: point.y,
      items: buildCommitTagMenuItems(commit, {
        onBranchFrom,
        onResetTo,
        onVisitCommit,
        onCreateTag: tagActionsEnabled ? onCreateTag : undefined,
        onDeleteTag: tagActionsEnabled ? onDeleteTag : undefined,
      }),
    });
  }

  function renderCommitNode(
    commit: CommitEntry,
    isAhead: boolean,
  ) {
    // The strip draws exactly one branch, so there is no branch identity for
    // colour to carry here and it stays free for state. (`laneColor` still does
    // identity work in GraphView, where several branches share the screen.)
    // Previously this was `laneColor(index % 6)` — the commit's position in the
    // array, so colour varied per commit while encoding nothing.
    const color = isAhead ? "var(--accent)" : "var(--border-strong)";
    const active = commit.hash === selectedHash && !workingTreeActive;
    const tags = tagRefs(commit.refs).map(tagName);
    const tagSummary = tags.length > 0 ? ` · ${tags.join(", ")}` : "";
    // "Not pushed" is state, which is what colour is free to carry in a strip
    // that only ever draws one branch. The boundary sits on the oldest one, so
    // the line is drawn once rather than between every pair.
    const unpushed = unpushedSet.has(commit.hash);
    const startsUnpushed = commit.hash === oldestUnpushedInView;
    // Position in the unpushed run, oldest = 0, so the colour walks the palette
    // in the order the commits were made. In the graph the palette answered
    // "which branch" and repeating it per merge was a lie; here every dot is
    // one branch and colour is free, so it can answer "where in the run".
    const unpushedIndex = unpushed ? unpushedOrder.get(commit.hash) ?? 0 : 0;
    return (
      <button
        className={`timeline-node ${active ? "active" : ""} ${isAhead ? "ahead" : ""}${
          unpushed ? " unpushed" : ""
        }${startsUnpushed ? " push-boundary" : ""}`}
        key={`${isAhead ? "ahead" : "ancestry"}-${commit.hash}`}
        type="button"
        ref={(node) => {
          if (node) nodeRefs.current.set(commit.hash, node);
          else nodeRefs.current.delete(commit.hash);
        }}
        onClick={() => selectCommit(commit)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openTagContextMenu({ x: event.clientX, y: event.clientY }, commit);
        }}
        {...bindLongPress((point) => openTagContextMenu(point, commit))}
        title={`${commit.shortHash} · ${commit.subject} · ${formatDate(commit.date)}${tagSummary}${isAhead ? " · ahead on branch" : ""}${unpushed ? " · not pushed yet" : ""}`}
      >
        {/* The push line, drawn on the oldest commit the remote does not have.
            A real element rather than a pseudo: ::after is the rail and
            ::before is the selection cursor. */}
        {startsUnpushed ? <span className="push-boundary-line" aria-hidden /> : null}
        {/* Hash above the dot, time below it, so the rail runs through the
            middle of the row instead of along its top edge and each commit
            reads as an identity sitting on the line with its age underneath. */}
        <span className="node-hash">{commit.shortHash}</span>
        {/* Unpushed commits walk the lane palette, oldest first. Colour is
            unspent in this strip -- it only ever draws one branch, so there is
            no branch identity for it to carry -- and this gives the run of
            work you have not sent anywhere a shape you can see at a glance. */}
        <span
          className="node-dot"
          style={{
            background: isAhead ? "transparent" : unpushed ? laneColor(unpushedIndex) : color,
            boxShadow: isAhead
              ? undefined
              : `0 0 12px ${unpushed ? laneColor(unpushedIndex) : color}55`,
            outline: isAhead ? `2px dashed ${color}` : undefined,
            outlineOffset: isAhead ? 1 : undefined,
          }}
        />
        {/* Time and tags share the bottom line. A tag row of its own forced
            every node in the strip to be tall enough for it, tagged or not, so
            one tagged commit anywhere in history left every other commit
            sitting above a band of empty space. Inline, a tag costs the row
            nothing. */}
        <span className="node-meta-line">
          <span className="node-time">{formatRelativeTime(commit.date, now)}</span>
          {tags.length > 0 ? (
            <span className="node-tags">
              {tags.map((name) => (
                <TagBadge key={name} name={name} unpushed={unpushedTags?.has(name)} muted />
              ))}
            </span>
          ) : null}
        </span>
        {/* No subject here on purpose. At this node width the message clipped
            to a few characters, often mid-word and sometimes from both ends,
            which is not enough to recognise a commit by and cost a whole row
            of height on every node. The inspector shows it in full the moment
            a commit is selected, and arrow keys move that selection, so the
            message is one keypress away rather than permanently illegible.
            The strip's job is position and state; the message has a home. */}
        {isAhead ? <span className="node-ahead-label">ahead</span> : null}
      </button>
    );
  }

  // Pin the working-tree node to the right edge while history scrolls under it,
  // but only when it's the last node on the track — once you have ahead commits
  // or a merge preview sitting to its right, it's no longer "the present" and a
  // sticky overlay would cover them.
  const pinWorkingTree = ahead.length === 0 && !integrationPreview;

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
    // j = 0 is the reference tip (newest), pinned above the working tree.
    const dotX = (j: number) => rightX - GHOST_SPACING * j;
    const oldestX = dotX(visible - 1);
    const forkX = geom.forks[index];
    const ghost = "var(--text-secondary)";

    return (
      <div className="context-lane" key={`${lane.kind}-${lane.refName}`}>
        {/* The count used to be a separate element positioned one step further
            left, which collided with this tag whenever a lane was more than
            MAX_GHOST_DOTS behind and covered the branch name. One label. */}
        <span className="lane-tag" style={{ left: oldestX, top: dotY }}>
          <span className="chip-kind">Incoming</span>
          <GitBranch size={10} aria-hidden />
          <span className="chip-ref">{lane.refName}</span>
          <span className="lane-count">{lane.behind}</span>
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

  function renderSiblingChip() {
    if (!siblingTip) return null;
    return (
      <button
        type="button"
        className="context-chip sibling"
        title={`${siblingTip.name} · ${siblingTip.tip.subject}`}
        onClick={() => onSwitchSibling?.(siblingTip.name)}
        disabled={!onSwitchSibling}
      >
        <span className="chip-kind">Branch</span>
        <GitBranch size={12} aria-hidden />
        <span className="chip-ref">{siblingTip.name}</span>
        {siblingTip.ahead > 0 ? (
          <span className="chip-count ahead">
            <ArrowUp size={11} aria-hidden />
            {siblingTip.ahead}
          </span>
        ) : null}
      </button>
    );
  }

  const showPreviewActions = !!inPreview && !!onReturnToWorkingTree;

  const otherCheckouts = worktrees.filter((entry) => !entry.isCurrent && !entry.internal);
  // Opening another folder of a repository no longer saves it to the sidebar, so
  // the sidebar and the repo picker both keep naming the repository — correctly,
  // since it is the same project. That leaves the branch as the only hint you
  // moved, which is not enough when two folders sit on branches you did not
  // choose. Say the folder outright, but only when it is not the original clone.
  const currentCheckout = worktrees.find((entry) => entry.isCurrent && !entry.internal);
  const awayFromMainCheckout = !!currentCheckout && !currentCheckout.isMain;

  // What does not fit collapses into a trailing "+N" rather than vanishing at a
  // fixed width. The signature is what the row actually says, so the cached
  // natural widths are thrown away exactly when the content changes.
  const chipSignature = [
    currentBranch ?? "",
    siblingTip?.name ?? "",
    contextLanes.map((lane) => `${lane.kind}:${lane.refName}:${lane.behind}:${lane.ahead}`).join(),
    otherCheckouts.length,
    awayFromMainCheckout ? folderName(currentCheckout.path) : "",
  ].join("|");
  const { ref: chipsRef, hidden: hiddenChips } = usePriorityPlus(chipSignature);

  const showActions =
    (canUpdateFromMain && !!onUpdateFromMain) ||
    (canMergeIntoMain && !!onMergeIntoMain) ||
    !!onOpenVersion ||
    showPreviewActions;

  function renderContextChips() {
    if (contextLanes.length === 0 && !siblingTip && !showActions) return null;
    return (
      <div className="timeline-context-bar">
        {/* Owns the history region below it, so it heads the row that region
            already has rather than adding one. A segmented control because this
            is a view switch over one thing, not two separate actions. */}
        {onHistoryViewChange ? (
          <div className="view-switch" role="group" aria-label="History view">
            <button
              type="button"
              className={historyView === "strip" ? "active" : ""}
              aria-pressed={historyView === "strip"}
              onClick={() => onHistoryViewChange("strip")}
            >
              Timeline
            </button>
            <button
              type="button"
              className={historyView === "graph" ? "active" : ""}
              aria-pressed={historyView === "graph"}
              onClick={() => onHistoryViewChange("graph")}
            >
              Branches
            </button>
          </div>
        ) : null}
        {/* The chips are one group, not loose items in the row.

            As siblings of the actions they competed with them for width, and
            whichever rule won, someone lost: let a chip shrink freely and its
            own caption and count spilled over the chip beside it; give it an
            honest min-content floor and the group instead shoved the actions
            off the right edge. A group that clips its own overflow settles it
            -- the actions keep their width, and the chips give ground inside
            their own box, worst case losing the tail of the least important
            chip rather than a button. */}
        <div className="context-chips" ref={chipsRef as React.RefObject<HTMLDivElement>}>
        {/* Where you are. The row used to open with whichever other branch
            happened to be interesting, so nothing said which line was yours. */}
        {currentBranch ? (
          <div
            className="context-chip here"
            title={
              awayFromMainCheckout
                ? `${currentBranch} is checked out in ${currentCheckout.path}`
                : `${currentBranch} is checked out in this folder`
            }
          >
            <span className="chip-kind">Here</span>
            <GitBranch size={12} aria-hidden />
            <span className="chip-ref">{currentBranch}</span>
            {awayFromMainCheckout ? (
              <span className="chip-sync">
                <FolderOpen size={11} aria-hidden /> {folderName(currentCheckout.path)}
              </span>
            ) : null}
          </div>
        ) : null}
        {renderSiblingChip()}
        {/* The upstream lane is inert, not absent.

            It was briefly deleted on the grounds that the strip's "Incoming"
            tag said the same thing twenty pixels below. That was wrong in
            three ways: the tag only renders when you are actually behind, so
            "up to date with the remote" was then stated nowhere; the whole
            strip is unmounted in Branches view; and the tag's container is
            aria-hidden, so the chip was the only non-visual source of upstream
            divergence in the app. What was right about the deletion was
            removing its click-to-pull behaviour: it was pixel-identical to the
            inert chips beside it, differing only in `cursor`, so a status
            label ran an operation that rewrites the working tree while a
            button labelled Pull sat forty pixels above doing the same thing.
            One verb, one owner. The chip stays; the verb does not. */}
        {contextLanes.map((lane) => {
          const upstream = lane.kind === "upstream";
          const inSync = lane.behind === 0 && lane.ahead === 0;
          // Only what we learned over the network can go stale. A trunk lane is
          // a local branch, so it is always known-good.
          const freshness = upstream
            ? remoteFreshness(lastFetchedAt, now)
            : { state: "fresh" as const };
          const chipBody = (
            <>
              <span className="chip-kind">{upstream ? "Remote" : "Base"}</span>
              <GitBranch size={12} aria-hidden />
              <span className="chip-ref">{lane.refName}</span>
              {/* Counts say what they would cost you, in the words the buttons
                  use. A bare up/down arrow beside a number is ahead/behind
                  notation, which is the vocabulary this interface is supposed
                  not to have; "2 to update" matches "Update from main" and
                  needs nothing explained. */}
              {freshness.state === "unknown" ? (
                // Never reached, so "in sync" would be a guess presented as a
                // fact. Say what is actually known.
                <span className="chip-sync unknown">not checked</span>
              ) : inSync ? (
                <span className="chip-sync">in sync</span>
              ) : (
                <>
                  {lane.behind > 0 ? (
                    <span className="chip-count behind">{lane.behind} to update</span>
                  ) : null}
                  {lane.ahead > 0 ? (
                    <span className="chip-count ahead">{lane.ahead} to merge</span>
                  ) : null}
                </>
              )}
              {freshness.state === "stale" ? (
                <span className="chip-age">{freshness.age}</span>
              ) : null}
            </>
          );
          return (
            <div
              className={`context-chip${lane.behind > 0 ? " behind" : ""}`}
              key={`chip-${lane.kind}-${lane.refName}`}
              // The chips are a run of loose text to a screen reader otherwise:
              // "Remote origin/main 2 to update Base main in sync" with no
              // boundary between them and nothing saying what any of it is.
              role="group"
              aria-label={`${upstream ? "Remote" : "Base branch"} ${lane.refName}`}
            >
              {chipBody}
            </div>
          );
        })}
        {/* Other folders of this repository.

            One chip, not one per folder. A repository with a couple of
            checkouts and one running twenty agent worktrees are both normal,
            and enumerating them turned the row into seven wrapped lines that
            buried the timeline. The count answers "how many folders" at a
            glance; the list is one click away. */}
        {otherCheckouts.length > 0 ? (
          otherCheckouts.length === 1 ? (
            <button
              type="button"
              className="context-chip elsewhere"
              title={`${otherCheckouts[0].branch ?? "detached"} is checked out in ${otherCheckouts[0].path}`}
              onClick={() => onOpenCheckout?.(otherCheckouts[0].path)}
              disabled={!onOpenCheckout}
            >
              <span className="chip-kind">Folder</span>
              <FolderOpen size={12} aria-hidden />
              <span className="chip-ref">{folderName(otherCheckouts[0].path)}</span>
              {otherCheckouts[0].branch ? (
                <span className="chip-sync">{otherCheckouts[0].branch}</span>
              ) : null}
            </button>
          ) : (
            <button
              type="button"
              className="context-chip elsewhere"
              title="Other folders this repository is checked out in"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setContextMenu({
                  x: rect.left,
                  y: rect.bottom + 4,
                  items: otherCheckouts.map((entry) => ({
                    label: `${folderName(entry.path)}  ·  ${entry.branch ?? "detached"}`,
                    onClick: () => onOpenCheckout?.(entry.path),
                  })),
                });
              }}
              disabled={!onOpenCheckout}
            >
              <span className="chip-kind">Folders</span>
              <FolderOpen size={12} aria-hidden />
              <span className="chip-ref">{otherCheckouts.length}</span>
            </button>
          )
        ) : null}
        {/* What did not fit. Marked as the anchor so the measuring hook does
            not count it as one of the items competing for room, and rendered
            last so it reads as the tail of the row. Its menu is the full text
            of each hidden chip, which is why the chips keep their captions in
            the markup even when the row is too narrow to show them. */}
        {hiddenChips.length > 0 ? (
          <button
            type="button"
            className="context-chip chip-overflow"
            data-overflow-anchor="true"
            title={hiddenChips.join("  •  ")}
            aria-label={`${hiddenChips.length} more: ${hiddenChips.join(", ")}`}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setContextMenu({
                x: rect.left,
                y: rect.bottom + 4,
                items: hiddenChips.map((label) => ({ label, onClick: () => {} })),
              });
            }}
          >
            +{hiddenChips.length}
          </button>
        ) : null}
        </div>
        {showActions ? (
          <div className="timeline-actions">
            {/* Spelled out. These were briefly icon-only, back when they
                shared a line with four state readouts and 274px of labels was
                a quarter of the row. The readouts have their own row now, so
                the verbs are no longer competing with anything and there is no
                reason to make the user recall what an arrow means. Titles stay
                for the longer explanation. */}
            {canUpdateFromMain && onUpdateFromMain ? (
              <button
                type="button"
                className="timeline-action update"
                title="Rebase this branch onto the latest main"
                disabled={integrationBusy}
                onClick={onUpdateFromMain}
              >
                <ArrowDown size={13} aria-hidden />
                Update from main
              </button>
            ) : null}
            {canMergeIntoMain && onMergeIntoMain ? (
              <button
                type="button"
                className="timeline-action merge"
                title="Bring this branch's commits into main"
                disabled={integrationBusy}
                onClick={onMergeIntoMain}
              >
                <ArrowUp size={13} aria-hidden />
                Merge into main
              </button>
            ) : null}
            {/* Not gated on the preview. Opening the repository on disk is
                something every repository can always do, and hiding it except
                while previewing a commit meant you had to enter a mode to
                reach it. In the preview it opens that version's files; at the
                present it opens the folder you are working in. */}
            {onOpenVersion ? (
              <button
                type="button"
                className="timeline-action open-folder"
                title={
                  inPreview
                    ? "Open this version's files in a folder"
                    : "Open this repository's folder"
                }
                onClick={onOpenVersion}
              >
                <FolderOpen size={13} aria-hidden />
                Open in folder
              </button>
            ) : null}
            {showPreviewActions ? (
              <button
                type="button"
                className="timeline-action return-to-now"
                title="Back to your current work"
                onClick={onReturnToWorkingTree}
              >
                <span className="working-dot" />
                Back to now
                {changeCount > 0 ? <em>{changeCount}</em> : null}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="history-timeline">
      {renderContextChips()}
      {/* The graph shows the same history at higher density, so showing both
          would say everything twice. The context row above stays in place. */}
      {historyView === "graph" ? null : (
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
          {/* Spans from the boundary to the end of the track, so the label can
              stick to the left edge of the view. Inside the boundary node it
              scrolled away with the commit it marks, which is most of the time:
              the strip opens at the present and the unpushed run can be long. */}
          {boundaryX !== null ? (
            <div className="push-boundary-flag" style={{ left: boundaryX }}>
              <span className="push-boundary-label">not pushed</span>
            </div>
          ) : null}
          <div className="timeline-track">
          {ancestry.map((commit) => renderCommitNode(commit, false))}

          <button
            className={`timeline-node working-tree ${workingTreeActive ? "active" : ""} ${pinWorkingTree ? "pinned" : ""} ${changeCount > 0 ? "has-changes" : ""} ${ahead.length > 0 ? "ahead-bridge" : ""}`}
            type="button"
            ref={(node) => {
              if (node) nodeRefs.current.set("working-tree", node);
              else nodeRefs.current.delete("working-tree");
            }}
            onClick={selectWorkingTree}
          >
            {/* No dot. Every other node's dot marks a commit on the rail;
                the working tree is not a commit, so a dot here claimed a
                place on the line that this node does not occupy. The word
                carries it instead. */}
            <span className="node-hash node-now">Now</span>
            <span className="node-subject">
              {changeCount === 0
                ? "no changes"
                : `${changeCount} unsaved change${changeCount === 1 ? "" : "s"}`}
            </span>
          </button>

          {ahead.map((commit) => renderCommitNode(commit, true))}

          {integrationPreview ? (
            <div
              className={`timeline-node merge-preview${
                integrationPreview.done ? " merged" : ""
              }${integrationPreview.conflicts ? " conflicts" : ""}`}
              title={
                integrationPreview.kind === "merge"
                  ? integrationPreview.done
                    ? `Merged ${integrationPreview.branch} into ${integrationPreview.onto}`
                    : integrationPreview.conflicts
                      ? `Merge ${integrationPreview.branch} into ${integrationPreview.onto} — conflicts`
                      : `Merging ${integrationPreview.branch} into ${integrationPreview.onto}`
                  : integrationPreview.conflicts
                    ? `Update ${integrationPreview.branch} from ${integrationPreview.onto} — conflicts`
                    : `Updating ${integrationPreview.branch} from ${integrationPreview.onto}`
              }
            >
              {/* Same order as a commit node, so its dot lands on the rail
                  rather than above it. */}
              <span className="node-hash">{integrationPreview.onto}</span>
              <span className="node-dot merge-preview-dot" />
              <span className="node-subject">
                {integrationPreview.done
                  ? "merged"
                  : integrationPreview.conflicts
                    ? "conflicts"
                    : integrationPreview.kind === "merge"
                      ? "merging"
                      : "updating"}
              </span>
            </div>
          ) : null}
          </div>
        </div>
      </div>
      )}

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
