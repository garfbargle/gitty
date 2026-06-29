import type { BranchEntry, FileChange } from "../types";

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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/// A starting-point branch name guessed from what's currently changed, used only
/// as a placeholder hint. When several files share a top-level folder we name the
/// work after it (e.g. "checkout"); otherwise we fall back to the first file's
/// stem. Returns null when there's nothing useful to suggest.
export function suggestBranchName(changes: FileChange[] | undefined): string | null {
  const paths = (changes ?? []).map((c) => c.path).filter(Boolean);
  if (paths.length === 0) return null;

  const topFolders = new Set(
    paths.map((p) => (p.includes("/") ? p.split("/")[0] : "")).filter(Boolean),
  );
  if (topFolders.size === 1) {
    const folder = [...topFolders][0];
    const slug = slugify(folder);
    if (slug) return slug;
  }

  const first = paths[0];
  const file = first.split("/").pop() ?? first;
  const stem = file.replace(/\.[^.]+$/, "");
  const slug = slugify(stem);
  return slug || null;
}
