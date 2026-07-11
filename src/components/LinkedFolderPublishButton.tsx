import { useEffect, useRef, useState } from "react";
import { ArrowUpFromLine, Loader2, Settings } from "lucide-react";
import type { LinkedFolder } from "../types";

type LinkedFolderPublishButtonProps = {
  /** Known-source linked folders that can be published (a subtree push). */
  folders: LinkedFolder[];
  /** The folder currently being pushed, so its row shows a spinner. */
  busyPrefix?: string | null;
  loading?: boolean;
  disabled?: boolean;
  /** Push one folder's committed changes back to its source. */
  onPublish: (prefix: string) => Promise<void>;
  /** Deep-link to the Linked folders section. */
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

/// Top-bar chip for sending a linked folder's committed changes back to its
/// source — the outgoing counterpart to LinkedFolderUpdatesButton. Shown whenever
/// the repo has a known-source linked folder; publishing is a deliberate action,
/// so unlike the incoming chip it isn't gated on a network "ahead" check. The
/// push itself no-ops cleanly ("already up to date") when there's nothing to send.
export function LinkedFolderPublishButton({
  folders,
  busyPrefix = null,
  loading,
  disabled,
  onPublish,
  onOpenSettings,
}: LinkedFolderPublishButtonProps) {
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
      ? `Publish ${folders[0].prefix} to its source`
      : "Publish linked folders back to their sources";

  return (
    <div className={`linked-updates-group${open ? " open" : ""}`} ref={rootRef} aria-live="polite">
      <button
        type="button"
        className="linked-updates-main"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={isLocked}
        onClick={() => setOpen((current) => !current)}
      >
        <ArrowUpFromLine size={15} />
        Publish
      </button>

      {open ? (
        <div className="linked-updates-menu" role="menu">
          <div className="linked-updates-menu-head">
            {count === 1 ? "Send committed changes to the source" : "Send committed changes to sources"}
          </div>
          {folders.map((folder) => (
            <div className="linked-updates-item" key={folder.prefix} role="menuitem">
              <div className="linked-updates-item-body">
                <span className="linked-updates-item-name">{folder.prefix}</span>
                <span className="linked-updates-item-source">
                  {prettySource(folder.url)}
                  {folder.branch ? ` · ${folder.branch}` : ""}
                  {folder.dirty ? " · uncommitted edits" : ""}
                </span>
              </div>
              <button
                type="button"
                className="settings-btn"
                disabled={isLocked}
                onClick={() => void onPublish(folder.prefix)}
              >
                {busyPrefix === folder.prefix ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <ArrowUpFromLine size={14} />
                )}
                Publish
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
