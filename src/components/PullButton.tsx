import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Download, GitMerge, Loader2 } from "lucide-react";

export type PullPhase = "idle" | "pulling" | "done";

type PullButtonProps = {
  /** Commits the upstream has that this branch lacks — how far behind you are. */
  behind: number;
  /** Your commits the upstream lacks. When both are > 0 the branch has diverged
   * and a plain fast-forward isn't possible, so we expose the merge option. */
  ahead: number;
  /** The branch tracks a remote we can pull from. Without it there's nothing to do. */
  hasUpstream: boolean;
  pullPhase?: PullPhase;
  loading?: boolean;
  disabled?: boolean;
  /** Default pull — fast-forward when purely behind, otherwise rebase. */
  onPull: () => Promise<boolean>;
  /** Reconcile with a merge commit instead of rebasing (diverged branches). */
  onPullMerge: () => Promise<boolean>;
};

export function PullButton({
  behind,
  ahead,
  hasUpstream,
  pullPhase = "idle",
  loading,
  disabled,
  onPull,
  onPullMerge,
}: PullButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const badgeBehindRef = useRef(behind);

  // A rebase and a merge fast-forward identically when you're purely behind, so
  // the merge choice only earns its place once history has actually diverged.
  const diverged = behind > 0 && ahead > 0;
  const visible =
    hasUpstream && (behind > 0 || pullPhase === "pulling" || pullPhase === "done");
  const isBusy = pullPhase !== "idle";
  const isLocked = isBusy || !!disabled || !!loading;
  const showBadge = pullPhase === "pulling" || (pullPhase === "idle" && behind > 0);

  useEffect(() => {
    if (pullPhase === "idle") {
      badgeBehindRef.current = behind;
    }
  }, [behind, pullPhase]);

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

  const badgeCount = pullPhase === "pulling" ? badgeBehindRef.current : behind;

  function pullTitle() {
    if (pullPhase === "pulling") return "Pull in progress…";
    if (pullPhase === "done") return "Up to date";

    const summary = `${behind} commit${behind === 1 ? "" : "s"}`;
    if (diverged) {
      return `Pull ${summary} — your branch has diverged, so your commits replay on top (rebase). Use the menu to merge instead.`;
    }
    return `Fast-forward to bring in ${summary} from the remote`;
  }

  return (
    <div
      className={`pull-btn-group${diverged ? " diverged" : ""}${open ? " open" : ""}${pullPhase !== "idle" ? ` ${pullPhase}` : ""}`}
      ref={rootRef}
      aria-live="polite"
    >
      {showBadge ? (
        <span className="pull-btn-badge" aria-hidden="true">
          {badgeCount}
        </span>
      ) : null}
      <button
        type="button"
        className="pull-btn-main"
        title={pullTitle()}
        disabled={isLocked}
        aria-busy={pullPhase === "pulling"}
        onClick={() => void onPull()}
      >
        {pullPhase === "pulling" ? (
          <>
            <Loader2 size={15} className="spin" />
            Pulling…
          </>
        ) : pullPhase === "done" ? (
          <>
            <Check size={15} />
            Up to date
          </>
        ) : (
          <>
            <Download size={15} />
            Pull
          </>
        )}
      </button>

      {diverged ? (
        <button
          type="button"
          className="pull-btn-chevron"
          title="Pull options"
          disabled={isLocked}
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronDown size={14} />
        </button>
      ) : null}

      {open ? (
        <div className="pull-btn-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="pull-btn-menu-item"
            disabled={isLocked}
            onClick={() => {
              setOpen(false);
              void onPull();
            }}
          >
            <Download size={14} />
            <span>Pull (rebase)</span>
            <small>replay yours on top</small>
          </button>
          <button
            type="button"
            role="menuitem"
            className="pull-btn-menu-item"
            disabled={isLocked}
            onClick={() => {
              setOpen(false);
              void onPullMerge();
            }}
          >
            <GitMerge size={14} />
            <span>Pull with merge</span>
            <small>merge commit</small>
          </button>
        </div>
      ) : null}
    </div>
  );
}
