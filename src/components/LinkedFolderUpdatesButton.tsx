import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Loader2, Settings } from "lucide-react";
import type { LinkedFolder } from "../types";

type LinkedFolderUpdatesButtonProps = {
  /** Linked folders whose source has moved on — i.e. Update has something to pull.
   * The parent computes this from the on-fetch `check_subtree_updates` result, so
   * the chip shows only when there's genuinely work to do. */
  folders: LinkedFolder[];
  /** The folder currently being pulled, so its row shows a spinner. */
  busyPrefix?: string | null;
  loading?: boolean;
  disabled?: boolean;
  /** Pull one folder from its source. Shares the drawer's update path, so a
   * conflict routes into the same resolver. */
  onUpdate: (prefix: string) => Promise<void>;
  /** Deep-link to the Linked folders section for editing a source. */
  onOpenSettings?: () => void;
};

// Shorten a clone URL to something readable: "github.com/acme/ui-kit".
function prettySource(url: string): string {
  if (!url) return "source unknown";
  return url
    .replace(/^git@/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^ssh:\/\//, "")
    .replace(":", "/")
    .replace(/\.git$/, "");
}

/// Top-bar chip surfacing linked-folder updates the way PullButton surfaces
/// incoming branch commits — visible only when at least one folder is behind its
/// source. This is the *incoming* arrow; the future "Send changes back" affordance
/// (driven by a folder's `dirty` flag) is its outgoing counterpart and would slot
/// in alongside without reworking this.
export function LinkedFolderUpdatesButton({
  folders,
  busyPrefix = null,
  loading,
  disabled,
  onUpdate,
  onOpenSettings,
}: LinkedFolderUpdatesButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const isBusy = busyPrefix !== null;
  const isLocked = isBusy || !!disabled || !!loading;

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (isBusy) setOpen(false);
  }, [isBusy]);

  if (folders.length === 0) {
    return null;
  }

  const count = folders.length;
  const title =
    count === 1
      ? `${folders[0].prefix} has updates from its source`
      : `${count} linked folders have updates from their sources`;

  return (
    <div className={`linked-updates-group${open ? " open" : ""}`} ref={rootRef} aria-live="polite">
      <span className="linked-updates-badge" aria-hidden="true">
        {count}
      </span>
      <button
        type="button"
        className="linked-updates-main"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={isLocked}
        onClick={() => setOpen((current) => !current)}
      >
        <ArrowDownToLine size={15} />
        Linked updates
      </button>

      {open ? (
        <div className="linked-updates-menu" role="menu">
          <div className="linked-updates-menu-head">
            {count === 1 ? "1 folder has updates" : `${count} folders have updates`}
          </div>
          {folders.map((folder) => (
            <div className="linked-updates-item" key={folder.prefix} role="menuitem">
              <div className="linked-updates-item-body">
                <span className="linked-updates-item-name">{folder.prefix}</span>
                <span className="linked-updates-item-source">
                  {prettySource(folder.url)}
                  {folder.branch ? ` · ${folder.branch}` : ""}
                </span>
              </div>
              <button
                type="button"
                className="settings-btn primary"
                disabled={isLocked}
                onClick={() => void onUpdate(folder.prefix)}
              >
                {busyPrefix === folder.prefix ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <ArrowDownToLine size={14} />
                )}
                Update
              </button>
            </div>
          ))}
          {onOpenSettings ? (
            <button
              type="button"
              className="linked-updates-manage"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              <Settings size={13} />
              Manage linked folders
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
