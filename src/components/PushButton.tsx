import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Loader2, Upload } from "lucide-react";

export type PushPhase = "idle" | "pushing" | "done";

type PushButtonProps = {
  ahead: number;
  behind: number;
  unpushedTags?: number;
  hasRemotes: boolean;
  /** The current branch exists only locally — push to publish it, even with 0 commits ahead. */
  unpublished?: boolean;
  /** Force force-push affordances on even when `behind` is 0 — e.g. after a push was rejected as non-fast-forward. */
  forceSuggested?: boolean;
  pushPhase?: PushPhase;
  loading?: boolean;
  disabled?: boolean;
  onPush: () => Promise<boolean>;
  onForcePush: () => Promise<boolean>;
  /** Hard `git push --force` — overwrites the remote unconditionally, for when the lease is stale. */
  onOverwrite: () => Promise<boolean>;
};

export function PushButton({
  ahead,
  behind,
  unpushedTags = 0,
  hasRemotes,
  unpublished = false,
  forceSuggested = false,
  pushPhase = "idle",
  loading,
  disabled,
  onPush,
  onForcePush,
  onOverwrite,
}: PushButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const badgeAheadRef = useRef(ahead + unpushedTags);

  const pushCount = ahead + unpushedTags;
  const visible =
    hasRemotes &&
    (pushCount > 0 || unpublished || pushPhase === "pushing" || pushPhase === "done");
  const suggestsForcePush = behind > 0 || forceSuggested;
  const isBusy = pushPhase !== "idle";
  const isLocked = isBusy || !!disabled || !!loading;
  const showBadge = pushPhase === "pushing" || (pushPhase === "idle" && pushCount > 0);

  useEffect(() => {
    if (pushPhase === "idle") {
      badgeAheadRef.current = pushCount;
    }
  }, [pushCount, pushPhase]);

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

  if (!visible) {
    return null;
  }

  const badgeCount = pushPhase === "pushing" ? badgeAheadRef.current : pushCount;

  // Right-click anywhere on the button opens the push menu so force push is
  // always reachable — even when we haven't detected divergence (e.g. the
  // ahead/behind counts are stale). It's a deliberate two-step: open, then
  // choose "Force push" (which still asks for confirmation).
  function handleContextMenu(event: React.MouseEvent) {
    event.preventDefault();
    if (isLocked) return;
    setOpen(true);
  }

  function pushTitle() {
    if (pushPhase === "pushing") return "Push in progress…";
    if (pushPhase === "done") return "Push completed";

    const parts: string[] = [];
    if (ahead > 0) {
      parts.push(`${ahead} commit${ahead === 1 ? "" : "s"}`);
    }
    if (unpushedTags > 0) {
      parts.push(`${unpushedTags} tag${unpushedTags === 1 ? "" : "s"}`);
    }
    const summary = parts.length > 0 ? parts.join(" and ") : "changes";

    const forceHint = "  •  right-click for push options";
    if (unpublished && pushCount === 0) {
      return `Publish this branch to the remote${forceHint}`;
    }
    if (behind > 0) {
      return `Push ${summary} — remote has ${behind} newer commit${behind === 1 ? "" : "s"}${forceHint}`;
    }
    if (suggestsForcePush) {
      return `Push ${summary} — remote rejected the last push${forceHint}`;
    }
    return `Push ${summary}${forceHint}`;
  }

  return (
    <div
      className={`push-btn-group${suggestsForcePush ? " diverged" : ""}${open ? " open" : ""}${pushPhase !== "idle" ? ` ${pushPhase}` : ""}`}
      ref={rootRef}
      aria-live="polite"
      onContextMenu={handleContextMenu}
    >
      {showBadge ? (
        <span className="push-btn-badge" aria-hidden="true">
          {badgeCount}
        </span>
      ) : null}
      <button
        type="button"
        className="push-btn-main"
        title={pushTitle()}
        disabled={isLocked}
        aria-busy={pushPhase === "pushing"}
        onClick={() => void onPush()}
      >
        {pushPhase === "pushing" ? (
          <>
            <Loader2 size={15} className="spin" />
            Pushing…
          </>
        ) : pushPhase === "done" ? (
          <>
            <Check size={15} />
            Pushed
          </>
        ) : (
          <>
            <Upload size={15} />
            Push
            <kbd>⌘⇧↵</kbd>
          </>
        )}
      </button>

      {suggestsForcePush ? (
        <button
          type="button"
          className="push-btn-chevron"
          title="Push options"
          disabled={isLocked}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronDown size={14} />
        </button>
      ) : null}

      {open ? (
        <div className="push-btn-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="push-btn-menu-item"
            disabled={isLocked}
            onClick={() => {
              setOpen(false);
              void onPush();
            }}
          >
            <Upload size={14} />
            <span>Push</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="push-btn-menu-item danger"
            disabled={isLocked}
            onClick={() => {
              setOpen(false);
              void onForcePush();
            }}
          >
            <AlertTriangle size={14} />
            <span>Force push</span>
            <small>--force-with-lease</small>
          </button>
          <button
            type="button"
            role="menuitem"
            className="push-btn-menu-item danger"
            disabled={isLocked}
            onClick={() => {
              setOpen(false);
              void onOverwrite();
            }}
          >
            <AlertTriangle size={14} />
            <span>Overwrite remote</span>
            <small>--force</small>
          </button>
        </div>
      ) : null}
    </div>
  );
};
