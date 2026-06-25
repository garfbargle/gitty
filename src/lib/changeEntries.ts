import type { ChangeSection, FileChange } from "../types";
import { isStaged, isUnstaged } from "./git";

export type ChangeEntry = {
  file: FileChange;
  section: ChangeSection;
  key: string;
};

export function buildWorkingEntries(changes: FileChange[]): ChangeEntry[] {
  const unstaged = changes.filter(isUnstaged);
  const staged = changes.filter(isStaged);
  return [
    ...unstaged.map((file) => ({
      file,
      section: "unstaged" as const,
      key: `unstaged:${file.path}`,
    })),
    ...staged.map((file) => ({
      file,
      section: "staged" as const,
      key: `staged:${file.path}`,
    })),
  ];
}

export function buildCommitEntries(changes: FileChange[]): ChangeEntry[] {
  return changes.map((file) => ({
    file,
    section: "commit" as const,
    key: `commit:${file.path}`,
  }));
}

export function buildChangeEntries(
  changes: FileChange[],
  variant: "working" | "commit",
): ChangeEntry[] {
  return variant === "commit" ? buildCommitEntries(changes) : buildWorkingEntries(changes);
}

export function moveChangeSelection(
  entries: ChangeEntry[],
  activeIndex: number,
  delta: number,
): ChangeEntry | null {
  if (entries.length === 0) return null;
  const start = activeIndex >= 0 ? activeIndex : delta > 0 ? -1 : entries.length;
  const next = Math.max(0, Math.min(entries.length - 1, start + delta));
  return entries[next];
}

export function rangeSelectKeys(
  entries: ChangeEntry[],
  fromIndex: number,
  toIndex: number,
): string[] {
  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  return entries.slice(start, end + 1).map((entry) => entry.key);
}
