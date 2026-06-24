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

export function pickerCommits(commits: CommitEntry[], aheadCommits: CommitEntry[]): CommitEntry[] {
  const seen = new Set(commits.map((commit) => commit.hash));
  const ahead = aheadCommits.filter((commit) => !seen.has(commit.hash));
  return [...ahead, ...commits];
}
