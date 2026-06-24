import type { FileChange } from "../types";

export function isStaged(change: FileChange) {
  const index = change.status[0] ?? " ";
  return index !== " " && index !== "?";
}

export function isUnstaged(change: FileChange) {
  const worktree = change.status[1] ?? " ";
  return worktree !== " ";
}

export function isUntracked(change: FileChange) {
  const index = change.status[0] ?? " ";
  const worktree = change.status[1] ?? " ";
  return index === "?" && worktree === "?";
}

export function changePathsKey(changes: FileChange[]): string {
  return [...new Set(changes.map((change) => change.path))].sort().join("|");
}

export function stagedPathsKey(changes: FileChange[]): string {
  return changes
    .filter(isStaged)
    .map((change) => change.path)
    .sort()
    .join("|");
}

function optimisticStaged(change: FileChange): FileChange {
  const index = change.status[0] ?? " ";
  const worktree = change.status[1] ?? " ";
  if (index === "?" && worktree === "?") {
    return { ...change, status: "A " };
  }
  const stagedIndex = index !== " " && index !== "?" ? index : worktree !== " " ? worktree : "M";
  return { ...change, status: `${stagedIndex} ` };
}

function optimisticUnstaged(change: FileChange): FileChange {
  const index = change.status[0] ?? " ";
  const worktree = change.status[1] ?? " ";
  if (index === "A" && worktree === " ") {
    return { ...change, status: "??" };
  }
  const wt = worktree !== " " ? worktree : index !== " " && index !== "?" ? index : "M";
  return { ...change, status: ` ${wt}` };
}

export function applyStageToChanges(
  changes: FileChange[],
  paths: string[],
  stage: boolean,
): FileChange[] {
  if (paths.length === 0) return changes;
  const pathSet = new Set(paths);
  return changes.map((change) => {
    if (!pathSet.has(change.path)) return change;
    return stage ? optimisticStaged(change) : optimisticUnstaged(change);
  });
}

export function statusCode(status: string) {
  const index = status[0] ?? " ";
  const worktree = status[1] ?? " ";
  if (index === "?" && worktree === "?") return "?";
  if (index === "A" || worktree === "A") return "A";
  if (index === "D" || worktree === "D") return "D";
  if (index === "R") return "R";
  return "M";
}

export function statusLabel(status: string) {
  const code = statusCode(status);
  if (code === "?") return "Untracked";
  if (code === "A") return "Added";
  if (code === "D") return "Deleted";
  if (code === "R") return "Renamed";
  return "Modified";
}

export function statusTone(status: string) {
  const code = statusCode(status);
  if (code === "A") return "added";
  if (code === "D") return "deleted";
  if (code === "R") return "renamed";
  if (code === "?") return "untracked";
  return "modified";
}

export function formatCommitDate(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatCommitTime(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDate(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

export function formatRelativeTime(date: string, now = Date.now()) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;

  const diffMs = now - parsed.getTime();
  if (diffMs < 0) return "now";

  const seconds = Math.floor(diffMs / SECOND_MS);
  if (seconds < 60) return `${Math.max(1, seconds)}s ago`;

  const minutes = Math.floor(diffMs / MINUTE_MS);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(diffMs / HOUR_MS);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(diffMs / DAY_MS);
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(diffMs / WEEK_MS);
  if (weeks < 5) return `${weeks}w ago`;

  const months = Math.floor(diffMs / MONTH_MS);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(diffMs / YEAR_MS);
  return `${Math.max(1, years)}y ago`;
}

export function relativeTimeRefreshMs(dates: string[], now = Date.now()) {
  let youngestAge = Infinity;

  for (const date of dates) {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) continue;
    const age = now - parsed.getTime();
    if (age >= 0 && age < youngestAge) youngestAge = age;
  }

  if (!Number.isFinite(youngestAge)) return null;
  if (youngestAge < MINUTE_MS) return SECOND_MS;
  if (youngestAge < HOUR_MS) return MINUTE_MS;
  if (youngestAge < DAY_MS) return HOUR_MS;
  return null;
}

export function parseRefs(refs: string) {
  return refs
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function primaryRef(refs: string) {
  const parsed = parseRefs(refs);
  const head = parsed.find((ref) => ref.includes("HEAD"));
  if (head) return head.replace("HEAD -> ", "");
  const branch = parsed.find((ref) => !ref.startsWith("tag:"));
  return branch?.replace("tag: ", "") ?? "";
}

export function tagRefs(refs: string) {
  return parseRefs(refs).filter((ref) => ref.startsWith("tag:"));
}

export function tagName(ref: string) {
  return ref.replace(/^tag:\s*/, "");
}

export function branchRefs(refs: string) {
  return parseRefs(refs).filter((ref) => !ref.startsWith("tag:") && !ref.includes("HEAD"));
}

export function authorInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function shortenPath(path: string, home = "~") {
  if (path.startsWith("/Users/")) {
    const parts = path.split("/");
    if (parts.length >= 3) {
      return `${home}/${parts.slice(3).join("/")}`;
    }
  }
  return path;
}
