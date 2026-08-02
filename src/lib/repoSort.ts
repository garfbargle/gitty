import type { DiscoveredRepoEntry, RepoEntry, RepoSortMode } from "../types";

/// Ordering for the repository sidebar.
///
/// Generic over the entry shape so the same ordering applies to saved and
/// discovered repositories. The sort control sits in the sidebar header, above
/// both lists, so it has to govern both: applying it only to the saved list
/// made the control look broken to anyone whose sidebar was showing discovered
/// repositories, which is the default state before any repo is saved.
export function sortRepos<T extends RepoEntry>(repos: T[], mode: RepoSortMode): T[] {
  // Manual order is whatever the user dragged the saved list into, and
  // discovery order (most recently edited first) for the discovered list.
  if (mode === "manual") return repos;

  const byName = (left: T, right: T) =>
    left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }) ||
    left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: "base" });

  // Saved repos carry Git activity; discovered ones only know when their
  // folder was last written to.
  const recency = (repo: T) =>
    repo.lastActivityAt ?? (repo as Partial<DiscoveredRepoEntry>).lastEditedAt ?? 0;

  return [...repos].sort((left, right) => {
    if (mode === "name-asc") return byName(left, right);
    if (mode === "name-desc") return byName(right, left);
    if (mode === "recent") return recency(right) - recency(left) || byName(left, right);
    return (
      Number(Boolean(right.hasUncommittedChanges)) -
        Number(Boolean(left.hasUncommittedChanges)) || byName(left, right)
    );
  });
}
