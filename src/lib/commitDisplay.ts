import type { CommitEntry } from "../types";

export function aheadCommitHashes(aheadCommits: CommitEntry[]): Set<string> {
  return new Set(aheadCommits.map((commit) => commit.hash));
}

export function ancestryTimelineCommits(commits: CommitEntry[]): CommitEntry[] {
  return [...commits].reverse();
}

export function aheadTimelineCommits(aheadCommits: CommitEntry[]): CommitEntry[] {
  return [...aheadCommits].reverse();
}

/// Where the push boundary falls, and how far along the unpushed run each
/// commit sits.
///
/// `ancestry` is the strip's order, which `ancestryTimelineCommits` has already
/// reversed to oldest-first — the direction the timeline reads. Getting that
/// backwards puts the boundary marker on the newest commit instead of the
/// oldest and runs the palette the wrong way, and both look plausible enough
/// on screen to miss, which is why this is a function with tests rather than a
/// few lines inside the component.
export function unpushedTimeline(
  ancestry: CommitEntry[],
  unpushedHashes: Iterable<string>,
): { oldestUnpushed: string | null; order: Map<string, number> } {
  const unpushed = new Set(unpushedHashes);
  const order = new Map<string, number>();
  if (unpushed.size === 0) return { oldestUnpushed: null, order };

  const marked = ancestry.filter((commit) => unpushed.has(commit.hash));
  // Oldest first, so index 0 is where the run begins and the palette advances
  // in the order the commits were written.
  marked.forEach((commit, index) => order.set(commit.hash, index));
  return { oldestUnpushed: marked.length > 0 ? marked[0].hash : null, order };
}

export function pickerCommits(commits: CommitEntry[], aheadCommits: CommitEntry[]): CommitEntry[] {
  const seen = new Set(commits.map((commit) => commit.hash));
  const ahead = aheadCommits.filter((commit) => !seen.has(commit.hash));
  return [...ahead, ...commits];
}
