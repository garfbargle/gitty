import type { CommitEntry } from "../types";
import { aheadTimelineCommits, ancestryTimelineCommits } from "./commitDisplay";

export type TimelineItem =
  | { kind: "commit"; commit: CommitEntry; ahead?: boolean }
  | { kind: "working-tree" };

export function buildTimelineItems(
  commits: CommitEntry[],
  aheadCommits: CommitEntry[] = [],
): TimelineItem[] {
  const aheadHashes = new Set(aheadCommits.map((commit) => commit.hash));
  return [
    ...ancestryTimelineCommits(commits).map((commit) => ({
      kind: "commit" as const,
      commit,
      ahead: false,
    })),
    { kind: "working-tree" as const },
    ...aheadTimelineCommits(aheadCommits).map((commit) => ({
      kind: "commit" as const,
      commit,
      ahead: aheadHashes.has(commit.hash),
    })),
  ];
}

export function timelineSelectionIndex(
  items: TimelineItem[],
  selectedHash?: string,
  workingTreeActive?: boolean,
): number {
  if (workingTreeActive) return items.length - 1;
  if (!selectedHash) return items.length - 1;
  const index = items.findIndex(
    (item) => item.kind === "commit" && item.commit.hash === selectedHash,
  );
  return index >= 0 ? index : items.length - 1;
}

export function moveTimelineSelection(
  items: TimelineItem[],
  currentIndex: number,
  delta: number,
): TimelineItem | null {
  if (items.length === 0) return null;
  const next = Math.max(0, Math.min(items.length - 1, currentIndex + delta));
  if (next === currentIndex) return null;
  return items[next];
}
