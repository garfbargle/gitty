import type { RepoAction } from "../types";

/// Commands the user typed themselves, kept per repository. Detection only
/// finds what a project declares (package.json, Cargo.toml, Makefile, scripts/);
/// a repository that declares nothing still deserves a Run button, so anything
/// typed here is saved alongside the detected list rather than run once and lost.

const STORAGE_PREFIX = "gitty.customActions:";

function storageKey(repoPath: string) {
  return `${STORAGE_PREFIX}${repoPath}`;
}

export function loadCustomActions(repoPath: string): RepoAction[] {
  if (!repoPath) return [];
  try {
    const raw = localStorage.getItem(storageKey(repoPath));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is RepoAction =>
          !!entry &&
          typeof entry.id === "string" &&
          typeof entry.command === "string" &&
          entry.command.trim().length > 0,
      )
      .map((entry) => ({
        id: entry.id,
        name: typeof entry.name === "string" && entry.name ? entry.name : entry.command,
        command: entry.command,
        category: "custom" as const,
        description: typeof entry.description === "string" ? entry.description : null,
      }));
  } catch {
    return [];
  }
}

export function saveCustomActions(repoPath: string, actions: RepoAction[]) {
  if (!repoPath) return;
  try {
    if (actions.length === 0) {
      localStorage.removeItem(storageKey(repoPath));
      return;
    }
    localStorage.setItem(storageKey(repoPath), JSON.stringify(actions));
  } catch {
    // Storage can be unavailable or full; the command still runs this session.
  }
}

export function makeCustomAction(command: string, name?: string): RepoAction {
  const trimmed = command.trim();
  return {
    id: `custom:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    name: name?.trim() || trimmed,
    command: trimmed,
    category: "custom",
    description: name?.trim() ? trimmed : null,
  };
}

/// Same command twice is a duplicate, not a second entry.
export function addCustomAction(existing: RepoAction[], action: RepoAction): RepoAction[] {
  const already = existing.find((entry) => entry.command === action.command);
  if (already) return existing;
  return [...existing, action];
}
