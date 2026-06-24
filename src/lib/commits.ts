import type { CommitEntry } from "../types";

export const INITIAL_COMMIT_LIMIT = 40;
export const COMMIT_PAGE_SIZE = 50;

export function commitsPageHasMore(count: number, pageSize: number): boolean {
  return count >= pageSize;
}

export function appendUniqueCommits(existing: CommitEntry[], more: CommitEntry[]): CommitEntry[] {
  const seen = new Set(existing.map((commit) => commit.hash));
  const appended = more.filter((commit) => !seen.has(commit.hash));
  if (appended.length === 0) return existing;
  return [...existing, ...appended];
}
