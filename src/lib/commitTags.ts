import type { ContextMenuItem } from "../components/ContextMenu";
import type { CommitEntry } from "../types";
import { tagName, tagRefs } from "./git";

export function buildCommitTagMenuItems(
  commit: CommitEntry,
  handlers: {
    onCreateTag: (commit: CommitEntry) => void;
    onDeleteTag: (commit: CommitEntry, name: string) => void;
  },
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { label: "Create tag…", onClick: () => handlers.onCreateTag(commit) },
  ];

  for (const ref of tagRefs(commit.refs)) {
    const name = tagName(ref);
    items.push({
      label: `Delete tag "${name}"`,
      onClick: () => handlers.onDeleteTag(commit, name),
    });
  }

  return items;
}
