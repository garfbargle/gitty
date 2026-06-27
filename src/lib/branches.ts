import type { BranchEntry } from "../types";

/// Branches other than the one you're on, worth showing in the working-tree
/// view: locals always, plus any remote branch not already represented by a
/// local (so "github/main" collapses into the local "main" that tracks it).
/// Sorted most-recently-active first and capped so the list stays scannable.
export function otherActiveBranches(
  branches: BranchEntry[] | undefined,
  current: string | undefined,
  limit = 8,
): BranchEntry[] {
  const list = branches ?? [];
  const locals = list.filter((b) => !b.isRemote);
  const localNames = new Set(locals.map((b) => b.name));
  const trackedRemotes = new Set(
    locals.map((b) => b.upstream).filter((value): value is string => !!value),
  );

  const rows = list.filter((b) => {
    if (b.name === current) return false;
    if (b.isRemote) {
      const leaf = b.name.split("/").slice(1).join("/");
      if (trackedRemotes.has(b.name) || localNames.has(leaf)) return false;
    }
    return true;
  });

  rows.sort((a, b) => (b.lastCommitDate ?? "").localeCompare(a.lastCommitDate ?? ""));
  return rows.slice(0, limit);
}
