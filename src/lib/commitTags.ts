import type { ContextMenuItem } from "../components/ContextMenu";
import type { CommitEntry } from "../types";
import { tagName, tagRefs } from "./git";

type CommitTagMenuHandlers = {
  onCreateTag?: (commit: CommitEntry) => void;
  onDeleteTag?: (commit: CommitEntry, name: string) => void;
  onVisitCommit?: (commit: CommitEntry) => void;
};

export function buildCommitTagMenuItems(
  commit: CommitEntry,
  handlers?: CommitTagMenuHandlers,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { label: "Copy SHA", onClick: () => void navigator.clipboard.writeText(commit.hash) },
  ];

  if (handlers?.onVisitCommit) {
    items.push({ label: "Visit commit…", onClick: () => handlers.onVisitCommit!(commit) });
  }

  if (handlers?.onCreateTag) {
    items.push({ label: "Create tag…", onClick: () => handlers.onCreateTag!(commit) });
  }

  if (handlers?.onDeleteTag) {
    for (const ref of tagRefs(commit.refs)) {
      const name = tagName(ref);
      items.push({
        label: `Delete tag "${name}"`,
        onClick: () => handlers.onDeleteTag!(commit, name),
      });
    }
  }

  return items;
}
