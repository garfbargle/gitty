import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { AlertTriangle, Check, ChevronDown, Loader2, Upload } from "lucide-react";

type PushPhase = "idle" | "pushing" | "done";

export type PushButtonHandle = {
  triggerPush: () => void;
};

type PushButtonProps = {
  ahead: number;
  behind: number;
  hasRemotes: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPush: () => Promise<boolean>;
  onForcePush: () => Promise<boolean>;
};

export const PushButton = forwardRef<PushButtonHandle, PushButtonProps>(function PushButton(
  {
    ahead,
    behind,
    hasRemotes,
    loading,
    disabled,
    onPush,
    onForcePush,
  },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<PushPhase>("idle");
  const rootRef = useRef<HTMLDivElement>(null);
  const doneTimerRef = useRef<number | null>(null);
  const badgeAheadRef = useRef(ahead);
  const inFlightRef = useRef(false);
  const onPushRef = useRef(onPush);
  const onForcePushRef = useRef(onForcePush);

  onPushRef.current = onPush;
  onForcePushRef.current = onForcePush;

  const visible = hasRemotes && (ahead > 0 || phase !== "idle");
  const suggestsForcePush = behind > 0;
  const isLocked = phase !== "idle" || !!disabled || !!loading;

  const startPushing = useCallback(() => {
    flushSync(() => {
      badgeAheadRef.current = ahead;
      if (doneTimerRef.current !== null) {
        window.clearTimeout(doneTimerRef.current);
        doneTimerRef.current = null;
      }
      setPhase("pushing");
    });
  }, [ahead]);

  const finishPush = useCallback((success: boolean) => {
    if (success) {
      setPhase("done");
      if (doneTimerRef.current !== null) {
        window.clearTimeout(doneTimerRef.current);
      }
      doneTimerRef.current = window.setTimeout(() => {
        setPhase("idle");
        doneTimerRef.current = null;
      }, 1600);
    } else {
      setPhase("idle");
    }
  }, []);

  const runPush = useCallback(
    async (action: () => Promise<boolean>) => {
      if (inFlightRef.current || disabled || loading) return;

      inFlightRef.current = true;
      startPushing();

      try {
        const success = await action();
        finishPush(success);
      } finally {
        inFlightRef.current = false;
      }
    },
    [disabled, finishPush, loading, startPushing],
  );

  useImperativeHandle(
    ref,
    () => ({
      triggerPush: () => {
        void runPush(onPushRef.current);
      },
    }),
    [runPush],
  );

  useEffect(() => {
    if (phase === "idle") {
      badgeAheadRef.current = ahead;
    }
  }, [ahead, phase]);

  useEffect(() => {
    return () => {
      if (doneTimerRef.current !== null) {
        window.clearTimeout(doneTimerRef.current);
      }
    };
  }, []);

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
    if (phase !== "idle") setOpen(false);
  }, [phase]);

  if (!visible) {
    return null;
  }

  const badgeCount = phase === "idle" ? ahead : badgeAheadRef.current;

  return (
    <div
      className={`push-btn-group${suggestsForcePush ? " diverged" : ""}${open ? " open" : ""}${phase !== "idle" ? ` ${phase}` : ""}`}
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
          phase === "pushing"
            ? "Push in progress…"
            : phase === "done"
              ? "Push completed"
              : suggestsForcePush
                ? `${ahead} commit${ahead === 1 ? "" : "s"} to push — remote has ${behind} newer commit${behind === 1 ? "" : "s"}`
                : `Push ${ahead} commit${ahead === 1 ? "" : "s"}`
        }
        disabled={isLocked}
        aria-busy={phase === "pushing"}
        onClick={() => void runPush(onPush)}
      >
        {phase === "pushing" ? (
          <>
            <Loader2 size={15} className="spin" />
            Pushing…
          </>
        ) : phase === "done" ? (
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
                  void runPush(onPush);
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
                  void runPush(onForcePush);
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
});
