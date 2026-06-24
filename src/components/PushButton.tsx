import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Loader2, Upload } from "lucide-react";

export type PushPhase = "idle" | "pushing" | "done";

type PushButtonProps = {
  ahead: number;
  behind: number;
  hasRemotes: boolean;
  pushPhase?: PushPhase;
  loading?: boolean;
  disabled?: boolean;
  onPush: () => Promise<boolean>;
  onForcePush: () => Promise<boolean>;
};

export function PushButton({
  ahead,
  behind,
  hasRemotes,
  pushPhase = "idle",
  loading,
  disabled,
  onPush,
  onForcePush,
}: PushButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const badgeAheadRef = useRef(ahead);

  const visible = hasRemotes && (ahead > 0 || pushPhase !== "idle");
  const suggestsForcePush = behind > 0;
  const isBusy = pushPhase !== "idle";
  const isLocked = isBusy || !!disabled || !!loading;

  useEffect(() => {
    if (pushPhase === "idle") {
      badgeAheadRef.current = ahead;
    }
  }, [ahead, pushPhase]);

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

  const badgeCount = pushPhase === "idle" ? ahead : badgeAheadRef.current;

  return (
    <div
      className={`push-btn-group${suggestsForcePush ? " diverged" : ""}${open ? " open" : ""}${pushPhase !== "idle" ? ` ${pushPhase}` : ""}`}
      ref={rootRef}
      aria-live="polite"
    >
      <span className="push-btn-badge" aria-hidden="true">
        {badgeCount}
      </span>
      <button
        type="button"
        className="push-btn-main"
        title={
          pushPhase === "pushing"
            ? "Push in progress…"
            : pushPhase === "done"
              ? "Push completed"
              : suggestsForcePush
                ? `${ahead} commit${ahead === 1 ? "" : "s"} to push — remote has ${behind} newer commit${behind === 1 ? "" : "s"}`
                : `Push ${ahead} commit${ahead === 1 ? "" : "s"}`
        }
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
        <>
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
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
};
