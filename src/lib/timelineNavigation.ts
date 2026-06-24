import type { CommitEntry } from "../types";

export type TimelineItem =
  | { kind: "commit"; commit: CommitEntry }
  | { kind: "working-tree" };

export function buildTimelineItems(commits: CommitEntry[]): TimelineItem[] {
  return [
    ...[...commits].reverse().map((commit) => ({ kind: "commit" as const, commit })),
    { kind: "working-tree" as const },
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
  return items[next];
}
