import type { CommitEntry } from "../types";

export type GraphRow = {
  commit: CommitEntry;
  lane: number;
  laneCount: number;
  continueDown: boolean;
  forkFrom?: number;
  mergeInto?: number;
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
  return LANE_COLORS[lane % LANE_COLORS.length];
}

export function buildGraphRows(commits: CommitEntry[]): GraphRow[] {
  const indexByHash = new Map(commits.map((commit, index) => [commit.hash, index]));
  const lanes: Array<string | null> = [];
  const rows: GraphRow[] = [];

  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];
    let lane = lanes.findIndex((hash) => hash === commit.hash);
    if (lane === -1) {
      lane = lanes.findIndex((hash) => hash === null);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(null);
      }
    }

    lanes[lane] = null;
    const firstParent = commit.parents[0];
    const parentIndex =
      firstParent !== undefined ? indexByHash.get(firstParent) : undefined;
    const continueDown = parentIndex === index + 1;
    if (continueDown && firstParent) {
      lanes[lane] = firstParent;
    }

    for (const parent of commit.parents.slice(1)) {
      if (indexByHash.has(parent)) {
        let mergeLane = lanes.findIndex((hash) => hash === null);
        if (mergeLane === -1) {
          mergeLane = lanes.length;
          lanes.push(null);
        }
        lanes[mergeLane] = parent;
      }
    }

    rows.push({
      commit,
      lane,
      laneCount: Math.max(lanes.length, lane + 1, 1),
      continueDown,
      forkFrom: commit.parents.length > 1 ? lane : undefined,
      mergeInto: commit.parents.length > 1 ? lane + 1 : undefined,
    });
  }

  return rows;
}
