import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Loader2, Tag, Upload } from "lucide-react";
import { SHORTCUT } from "../lib/shortcuts";

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
  /** Push tags as well. Opt-in, from the menu only — see `push` in App.tsx. */
  onPushTags?: () => Promise<boolean>;
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
  onPushTags,
}: PushButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const badgeAheadRef = useRef(ahead);

  // The badge counts commits, and only commits. It used to be ahead + tags,
  // which is two different kinds of thing summed into one number on a button
  // that says "Push" — so a fork holding 31 upstream release tags and nothing
  // of its own read as "31 to push" beside a bar reading "in sync". Both were
  // true; together they were a lie. Tags are reachable from the menu.
  const pushCount = ahead;
  const hasTagsToOffer = unpushedTags > 0 && !!onPushTags;
  const suggestsForcePush = behind > 0 || forceSuggested;
  const visible =
    hasRemotes &&
    (pushCount > 0 ||
      hasTagsToOffer ||
      unpublished ||
      suggestsForcePush ||
      pushPhase === "pushing" ||
      pushPhase === "done");
  const isBusy = pushPhase !== "idle";
  const isLocked = isBusy || !!disabled || !!loading;
  // Only tags are outstanding, so the primary click has nothing to do: a
  // commits-only push would return "Nothing to push." as an error. The button
  // opens the menu instead, which is where the tags live.
  const tagsOnly = pushCount === 0 && hasTagsToOffer && !unpublished && !suggestsForcePush;
  // `> 0` matters during a push: the frozen count is commits, so a tags-only
  // push used to sit next to a badge reading 0.
  const badgeCountNow = pushPhase === "pushing" ? badgeAheadRef.current : pushCount;
  const showBadge = pushPhase !== "done" && badgeCountNow > 0;

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

    const summary = ahead > 0 ? `${ahead} commit${ahead === 1 ? "" : "s"}` : "changes";

    const forceHint = "  •  right-click for push options";
    if (pushCount === 0 && hasTagsToOffer && !unpublished && !suggestsForcePush) {
      return `Nothing to push — ${unpushedTags} tag${unpushedTags === 1 ? "" : "s"} available from push options${forceHint}`;
    }
    if (unpublished && pushCount === 0) {
      return `Publish this branch to the remote${forceHint}`;
    }
    if (behind > 0 && pushCount === 0) {
      // Purely behind — a backward reset. A normal push can't help; force-push
      // to move the remote back to this commit.
      return `Force-push to reset the remote back ${behind} commit${behind === 1 ? "" : "s"}${forceHint}`;
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
          {badgeCountNow}
        </span>
      ) : null}
      <button
        type="button"
        className="push-btn-main"
        title={pushTitle()}
        disabled={isLocked}
        aria-busy={pushPhase === "pushing"}
        aria-haspopup={tagsOnly ? "menu" : undefined}
        aria-expanded={tagsOnly ? open : undefined}
        onClick={() => (tagsOnly ? setOpen((current) => !current) : void onPush())}
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
            <kbd>{SHORTCUT.push}</kbd>
          </>
        )}
      </button>

      {suggestsForcePush || hasTagsToOffer ? (
        <button
          type="button"
          className="push-btn-chevron"
          title="Push options"
          aria-label="Push options"
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
          {/* Hidden when only tags are outstanding: this item runs the same
              commits-only push the primary button does, so offering it there
              would just be a second way to reach "Nothing to push." */}
          {tagsOnly ? null : (
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
          )}
          {hasTagsToOffer ? (
            <button
              type="button"
              role="menuitem"
              className="push-btn-menu-item"
              disabled={isLocked}
              onClick={() => {
                setOpen(false);
                void onPushTags?.();
              }}
            >
              <Tag size={14} />
              <span>
                Push {unpushedTags} tag{unpushedTags === 1 ? "" : "s"}
              </span>
              <small>also publishes tags fetched from elsewhere</small>
            </button>
          ) : null}
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
