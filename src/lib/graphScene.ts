import type { BranchEntry, CommitEntry, WorktreeEntry } from "../types";
import { parseRefs } from "./git";

/// One line of work in the scene: a run of first-parent commits that is not
/// the trunk. Every non-trunk commit belongs to exactly one strand.
export type Strand = {
  id: number;
  /// Newest first.
  hashes: string[];
  /// Signed lane: negative is left of the trunk, positive is right. Never 0.
  lane: number;
  /// True when nothing in view descends from the tip — the work is still out
  /// there on its own, so it floats above the floor instead of lying on it.
  floating: boolean;
  colour: string;
  /// Row range this strand occupies, including the commit it forks from and
  /// the commit that merges it back, so its curves get room too.
  minRow: number;
  maxRow: number;
};

export type SceneCommit = {
  commit: CommitEntry;
  /// Row slot in the newest-first ordering; time axis in world units.
  row: number;
  lane: number;
  elevation: number;
  trunk: boolean;
  strand: Strand | null;
  colour: string;
};

/// A named line ending: something the user can switch to or open.
export type SceneTip = {
  hash: string;
  /// Local branch names pointing here (may be empty for a detached folder).
  branches: string[];
  /// Remote-tracking names pointing here, e.g. "github/main".
  remotes: string[];
  tags: string[];
  worktree: WorktreeEntry | null;
  isHead: boolean;
  isTrunkTip: boolean;
  /// Whether the tip earns a chip on the map. A remote-only name on work
  /// that is already merged is a receipt, not a place to go: it stays
  /// available to the inspector but does not clutter the floor.
  labelled: boolean;
};

export type GraphScene = {
  commits: SceneCommit[];
  byHash: Map<string, SceneCommit>;
  strands: Strand[];
  trunkHashes: Set<string>;
  trunkName: string;
  tips: SceneTip[];
  /// Widest lane in use on each side, for framing.
  lanesLeft: number;
  lanesRight: number;
};

export const TRUNK_COLOUR = "#3b82f6";

const STRAND_COLOURS = [
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#84cc16",
  "#e11d48",
];

const TRUNK_NAMES = ["main", "master", "trunk", "develop"];

type RefKinds = { locals: string[]; remotes: string[]; tags: string[]; head: boolean };

function classifyRefs(refs: string, remotePrefixes: Set<string>, localNames: Set<string>): RefKinds {
  const out: RefKinds = { locals: [], remotes: [], tags: [], head: false };
  for (const raw of parseRefs(refs)) {
    let ref = raw;
    if (ref.startsWith("HEAD -> ")) {
      out.head = true;
      ref = ref.slice("HEAD -> ".length);
    } else if (ref === "HEAD") {
      out.head = true;
      continue;
    }
    if (ref.startsWith("tag: ")) {
      out.tags.push(ref.slice(5));
      continue;
    }
    if (ref.endsWith("/HEAD")) continue;
    const prefix = ref.split("/")[0];
    // A local branch may itself contain "/" (feature/x). Only call it remote
    // when its first segment is a known remote and no local branch has the
    // exact same name.
    if (remotePrefixes.has(prefix) && !localNames.has(ref)) out.remotes.push(ref);
    else out.locals.push(ref);
  }
  return out;
}

/// Lays the history out on a floor: the trunk straight down the middle at
/// lane 0, and every other line of work in its own lane to one side, either
/// returning to the trunk at a merge or floating as an open tip.
export function buildGraphScene(
  commits: CommitEntry[],
  options: {
    headHash?: string;
    branches?: BranchEntry[];
    worktrees?: WorktreeEntry[];
  } = {},
): GraphScene {
  const { headHash, branches = [], worktrees = [] } = options;
  const byHashCommit = new Map(commits.map((commit) => [commit.hash, commit]));
  const rowOf = new Map(commits.map((commit, index) => [commit.hash, index]));

  const remotePrefixes = new Set(
    branches.filter((branch) => branch.isRemote).map((branch) => branch.name.split("/")[0]),
  );
  const localNames = new Set(branches.filter((branch) => !branch.isRemote).map((branch) => branch.name));
  const refsOf = new Map(
    commits.map((commit) => [commit.hash, classifyRefs(commit.refs, remotePrefixes, localNames)]),
  );

  // Children map, so a strand can tell whether anything comes after its tip.
  const children = new Map<string, string[]>();
  for (const commit of commits) {
    for (const parent of commit.parents) {
      const list = children.get(parent);
      if (list) list.push(commit.hash);
      else children.set(parent, [commit.hash]);
    }
  }

  // ---- Trunk -------------------------------------------------------------
  // The trunk is `main` (or its usual aliases) wherever it happens to be, not
  // whatever is checked out. If no such branch is in view, the main folder's
  // line stands in, then HEAD.
  const visibleFolders = worktrees.filter((entry) => !entry.internal && !entry.prunable);
  const mainFolder = visibleFolders.find((entry) => entry.isMain) ?? null;
  let trunkTip: string | undefined;
  let trunkName = "";
  outer: for (const name of TRUNK_NAMES) {
    for (const commit of commits) {
      if (refsOf.get(commit.hash)?.locals.includes(name)) {
        trunkTip = commit.hash;
        trunkName = name;
        break outer;
      }
    }
  }
  if (!trunkTip) {
    for (const name of TRUNK_NAMES) {
      const remoteTip = commits.find((commit) =>
        refsOf.get(commit.hash)?.remotes.some((ref) => ref.endsWith(`/${name}`)),
      );
      if (remoteTip) {
        trunkTip = remoteTip.hash;
        trunkName = refsOf.get(remoteTip.hash)!.remotes.find((ref) => ref.endsWith(`/${name}`))!;
        break;
      }
    }
  }
  if (!trunkTip && mainFolder && byHashCommit.has(mainFolder.head)) {
    trunkTip = mainFolder.head;
    trunkName = mainFolder.branch ?? "main folder";
  }
  if (!trunkTip && headHash && byHashCommit.has(headHash)) {
    trunkTip = headHash;
    trunkName = refsOf.get(headHash)?.locals[0] ?? "current";
  }
  if (!trunkTip && commits.length > 0) {
    trunkTip = commits[0].hash;
    trunkName = refsOf.get(trunkTip)?.locals[0] ?? "history";
  }

  const trunkHashes = new Set<string>();
  let cursor = trunkTip;
  while (cursor && byHashCommit.has(cursor) && !trunkHashes.has(cursor)) {
    trunkHashes.add(cursor);
    cursor = byHashCommit.get(cursor)?.parents[0];
  }

  // ---- Strands -----------------------------------------------------------
  // Walk newest-first. The first unassigned non-trunk commit we meet is a tip
  // (all of its children were already placed), and its first-parent chain is
  // the strand, ending where it reaches the trunk or another strand.
  const strandOf = new Map<string, Strand>();
  const strands: Strand[] = [];
  for (const commit of commits) {
    if (trunkHashes.has(commit.hash) || strandOf.has(commit.hash)) continue;
    const strand: Strand = {
      id: strands.length,
      hashes: [],
      lane: 0,
      floating: (children.get(commit.hash)?.length ?? 0) === 0,
      colour: STRAND_COLOURS[strands.length % STRAND_COLOURS.length],
      minRow: rowOf.get(commit.hash) ?? 0,
      maxRow: rowOf.get(commit.hash) ?? 0,
    };
    let walk: string | undefined = commit.hash;
    while (walk && byHashCommit.has(walk) && !trunkHashes.has(walk) && !strandOf.has(walk)) {
      strand.hashes.push(walk);
      strandOf.set(walk, strand);
      walk = byHashCommit.get(walk)?.parents[0];
    }
    strands.push(strand);
  }

  // Row extents: the strand's own commits, plus the commit it forks from and
  // the commits that merge it back — the curves need that room in the lane.
  for (const strand of strands) {
    for (const hash of strand.hashes) {
      const row = rowOf.get(hash)!;
      strand.minRow = Math.min(strand.minRow, row);
      strand.maxRow = Math.max(strand.maxRow, row);
      for (const parent of byHashCommit.get(hash)!.parents) {
        const parentRow = rowOf.get(parent);
        if (parentRow !== undefined) strand.maxRow = Math.max(strand.maxRow, parentRow);
      }
      for (const child of children.get(hash) ?? []) {
        const childRow = rowOf.get(child);
        if (childRow !== undefined) strand.minRow = Math.min(strand.minRow, childRow);
      }
    }
  }

  // ---- Lanes ---------------------------------------------------------------
  // Interval packing per side. Newest strands are placed first and get the
  // lanes nearest the trunk; anything overlapping in time steps outward. A
  // strand that forks off another strand stays on that strand's side, beyond
  // it, so the fork reads as a fork and not as a crossing.
  const occupancy = { left: [] as Array<Array<[number, number]>>, right: [] as Array<Array<[number, number]>> };
  const PAD = 1;
  function firstFree(side: "left" | "right", from: number, min: number, max: number) {
    const lanes = occupancy[side];
    for (let index = from; ; index += 1) {
      const used = lanes[index] ?? [];
      const clash = used.some(([a, b]) => !(max + PAD < a || min - PAD > b));
      if (!clash) return index;
    }
  }
  function occupy(side: "left" | "right", index: number, min: number, max: number) {
    const lanes = occupancy[side];
    while (lanes.length <= index) lanes.push([]);
    lanes[index].push([min, max]);
  }
  let alternate = 1;
  for (const strand of strands) {
    const oldest = strand.hashes[strand.hashes.length - 1];
    const forkParent = byHashCommit.get(oldest)?.parents[0];
    const parentStrand = forkParent ? strandOf.get(forkParent) : undefined;
    let side: "left" | "right";
    let index: number;
    if (parentStrand && parentStrand.lane !== 0) {
      side = parentStrand.lane < 0 ? "left" : "right";
      index = firstFree(side, Math.abs(parentStrand.lane), strand.minRow, strand.maxRow);
    } else {
      const left = firstFree("left", 0, strand.minRow, strand.maxRow);
      const right = firstFree("right", 0, strand.minRow, strand.maxRow);
      if (left < right) side = "left";
      else if (right < left) side = "right";
      else {
        side = alternate > 0 ? "right" : "left";
        alternate = -alternate;
      }
      index = side === "left" ? left : right;
    }
    occupy(side, index, strand.minRow, strand.maxRow);
    strand.lane = (index + 1) * (side === "left" ? -1 : 1);
  }

  // ---- Commits -----------------------------------------------------------
  const sceneCommits: SceneCommit[] = commits.map((commit, row) => {
    const trunk = trunkHashes.has(commit.hash);
    const strand = strandOf.get(commit.hash) ?? null;
    return {
      commit,
      row,
      lane: trunk ? 0 : strand?.lane ?? 0,
      elevation: strand?.floating ? 1 : 0,
      trunk,
      strand,
      colour: trunk ? TRUNK_COLOUR : strand?.colour ?? TRUNK_COLOUR,
    };
  });
  const byHash = new Map(sceneCommits.map((entry) => [entry.commit.hash, entry]));

  // ---- Tips ----------------------------------------------------------------
  // Anything named, plus every open folder's checkout, is a place the user
  // can go. One tip per commit even if several names share it.
  const tipHashes = new Set<string>();
  for (const commit of commits) {
    const kinds = refsOf.get(commit.hash)!;
    if (kinds.locals.length > 0 || kinds.remotes.length > 0 || kinds.head) tipHashes.add(commit.hash);
  }
  for (const folder of visibleFolders) if (byHashCommit.has(folder.head)) tipHashes.add(folder.head);
  if (headHash && byHashCommit.has(headHash)) tipHashes.add(headHash);
  const tips: SceneTip[] = [...tipHashes]
    .sort((a, b) => rowOf.get(a)! - rowOf.get(b)!)
    .map((hash) => {
      const kinds = refsOf.get(hash)!;
      // A remote name that just mirrors a local one here is noise.
      const remotes = kinds.remotes.filter((ref) => {
        const leaf = ref.split("/").slice(1).join("/");
        return !kinds.locals.includes(leaf);
      });
      const strand = strandOf.get(hash);
      const labelled = kinds.locals.length > 0
        || kinds.head
        || hash === headHash
        || hash === trunkTip
        || visibleFolders.some((entry) => entry.head === hash)
        || (!!strand && strand.floating && strand.hashes[0] === hash);
      return {
        hash,
        branches: kinds.locals,
        remotes,
        tags: kinds.tags,
        worktree: visibleFolders.find((entry) => entry.head === hash) ?? null,
        isHead: hash === headHash || kinds.head,
        isTrunkTip: hash === trunkTip,
        labelled,
      };
    });

  let lanesLeft = 0;
  let lanesRight = 0;
  for (const strand of strands) {
    if (strand.lane < 0) lanesLeft = Math.max(lanesLeft, -strand.lane);
    else lanesRight = Math.max(lanesRight, strand.lane);
  }

  return { commits: sceneCommits, byHash, strands, trunkHashes, trunkName, tips, lanesLeft, lanesRight };
}
