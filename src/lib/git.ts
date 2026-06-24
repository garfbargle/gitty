import type { FileChange } from "../types";

export function isStaged(change: FileChange) {
  const index = change.status[0] ?? " ";
  return index !== " " && index !== "?";
}

export function isUnstaged(change: FileChange) {
  const worktree = change.status[1] ?? " ";
  return worktree !== " ";
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
