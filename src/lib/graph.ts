import type { CommitEntry } from "../types";

/// A connection drawn in the band *below* a commit row, joining a lane at this
/// row's centre to a lane at the next row's centre. `fromLane === toLane` is a
/// straight pass-through; otherwise it curves (a fork or a merge).
export type GraphEdge = {
  fromLane: number;
  toLane: number;
  color: string;
  /// Internal: the persistent colour id of the lane this strand leaves from.
  /// Used to decide whether the strand belongs to the checked-out branch.
  colorIdx: number;
  /// True when this strand is part of the currently checked-out branch's
  /// first-parent history, so the renderer can draw it as the bold mainline.
  onHead: boolean;
};

export type GraphRow = {
  commit: CommitEntry;
  lane: number;
  color: string;
  colorIdx: number;
  laneCount: number;
  /// True when this commit sits on the checked-out branch's first-parent line.
  onHead: boolean;
  /// Strands leaving this commit downward, toward the next row.
  edges: GraphEdge[];
};

const LANE_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
];

export function laneColor(lane: number) {
  return LANE_COLORS[((lane % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length];
}

/// Lays out commits (newest first) into stable, coloured lanes and records the
/// connecting strands between every adjacent pair of rows. Unlike a per-lane
/// on/off renderer, this draws real fork/merge edges, so a merge's second parent
/// no longer appears out of nowhere.
export function buildGraphRows(commits: CommitEntry[], headHash?: string): GraphRow[] {
  // `lanes[k]` is the commit hash lane k is currently routing toward (the next
  // commit expected in that lane), or null when the lane is free. `laneColorIdx`
  // keeps a colour with a lane for as long as it stays continuously occupied, so
  // a branch keeps one colour down its whole length.
  const lanes: Array<string | null> = [];
  const laneColorIdx: number[] = [];
  let nextColor = 0;

  const rows: GraphRow[] = [];

  // Which commits are on the checked-out branch's first-parent line.
  //
  // Walked here, from the commits themselves, rather than inferred from lane
  // colour. Colour follows a lane only while that lane stays continuously
  // occupied; lanes are freed at merges and reused, so the head's colour id
  // changes partway down and a colour test silently stops matching. In a real
  // repository that marked the tip and one parent and left the rest of the
  // branch looking like somebody else's work.
  const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
  const onHeadHashes = new Set<string>();
  if (headHash) {
    let cursor: string | undefined = headHash;
    // The set is the cycle guard: history is a DAG, but a malformed parent
    // list must not spin here.
    while (cursor && byHash.has(cursor) && !onHeadHashes.has(cursor)) {
      onHeadHashes.add(cursor);
      cursor = byHash.get(cursor)?.parents[0];
    }
  }

  for (let i = 0; i < commits.length; i += 1) {
    const commit = commits[i];

    // Find the lane this commit lands in: a lane already waiting for it (its
    // child reserved one), otherwise the first free lane, otherwise a new one.
    let myLane = lanes.findIndex((hash) => hash === commit.hash);
    if (myLane === -1) {
      myLane = lanes.findIndex((hash) => hash === null);
      if (myLane === -1) {
        myLane = lanes.length;
        lanes.push(null);
        laneColorIdx.push(-1);
      }
      // A tip with no child in view starts a fresh colour.
      if (laneColorIdx[myLane] === -1) laneColorIdx[myLane] = nextColor++;
    }
    if (laneColorIdx[myLane] === -1) laneColorIdx[myLane] = nextColor++;

    // The band between the previous row and this one was reserved when we routed
    // the previous commit's parents. Resolve where each of those strands lands at
    // this row: anything pointing at this commit funnels into `myLane` (a merge),
    // everything else holds its column.
    if (i > 0) {
      const edges: GraphEdge[] = [];
      for (let k = 0; k < lanes.length; k += 1) {
        if (lanes[k] === null) continue;
        const toLane = lanes[k] === commit.hash ? myLane : k;
        edges.push({
          fromLane: k,
          toLane,
          color: laneColor(laneColorIdx[k]),
          colorIdx: laneColorIdx[k],
          // The strand is heading toward lanes[k]; it is part of the mainline
          // exactly when the commit it arrives at is.
          onHead: onHeadHashes.has(lanes[k] as string),
        });
      }
      rows[i - 1].edges = edges;
    }

    rows.push({
      commit,
      lane: myLane,
      color: laneColor(laneColorIdx[myLane]),
      colorIdx: laneColorIdx[myLane],
      laneCount: 0,
      onHead: onHeadHashes.has(commit.hash),
      edges: [],
    });

    // Free any other lane that was also waiting for this commit — they have just
    // merged into `myLane`.
    for (let k = 0; k < lanes.length; k += 1) {
      if (k !== myLane && lanes[k] === commit.hash) {
        lanes[k] = null;
        laneColorIdx[k] = -1;
      }
    }

    // Route the parents downward. The first parent continues this lane (and its
    // colour — the mainline). Extra parents (a merge) each take a lane and a
    // fresh colour for the side being brought in.
    const [firstParent, ...otherParents] = commit.parents;
    if (firstParent) {
      lanes[myLane] = firstParent;
    } else {
      lanes[myLane] = null;
      laneColorIdx[myLane] = -1;
    }
    for (const parent of otherParents) {
      let nl = lanes.findIndex((hash) => hash === null);
      if (nl === -1) {
        nl = lanes.length;
        lanes.push(null);
        laneColorIdx.push(-1);
      }
      lanes[nl] = parent;
      laneColorIdx[nl] = nextColor++;
    }

    // Trim trailing free lanes so the width reflects what's actually in use.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
      laneColorIdx.pop();
    }
    rows[i].laneCount = Math.max(lanes.length, myLane + 1, 1);
  }

  // The width each row reserves must cover its own lanes *and* every strand
  // leaving it, so curves into a wider next row aren't clipped.
  let widest = 1;
  for (const row of rows) {
    let rowMax = row.laneCount;
    for (const edge of row.edges) {
      rowMax = Math.max(rowMax, edge.fromLane + 1, edge.toLane + 1);
    }
    widest = Math.max(widest, rowMax);
  }
  for (const row of rows) row.laneCount = widest;

  return rows;
}
