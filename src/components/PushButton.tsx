import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Upload } from "lucide-react";

type PushButtonProps = {
  ahead: number;
  behind: number;
  hasRemotes: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPush: () => void;
  onForcePush: () => void;
};

export function PushButton({
  ahead,
  behind,
  hasRemotes,
  loading,
  disabled,
  onPush,
  onForcePush,
}: PushButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const canPush = hasRemotes && ahead > 0;
  const suggestsForcePush = behind > 0;

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

  if (!canPush) {
    return null;
  }

  const isDisabled = disabled || loading;

  return (
    <div
      className={`push-btn-group${suggestsForcePush ? " diverged" : ""}${open ? " open" : ""}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="push-btn-main"
        title={
          suggestsForcePush
            ? `${ahead} commit${ahead === 1 ? "" : "s"} to push — remote has ${behind} newer commit${behind === 1 ? "" : "s"}`
            : `Push ${ahead} commit${ahead === 1 ? "" : "s"}`
        }
        disabled={isDisabled}
        onClick={onPush}
      >
        <Upload size={15} />
        Push
        <em>{ahead}</em>
      </button>

      {suggestsForcePush ? (
        <>
          <button
            type="button"
            className="push-btn-chevron"
            title="Push options"
            disabled={isDisabled}
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
                disabled={isDisabled}
                onClick={() => {
                  setOpen(false);
                  onPush();
                }}
              >
                <Upload size={14} />
                <span>Push</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="push-btn-menu-item danger"
                disabled={isDisabled}
                onClick={() => {
                  setOpen(false);
                  onForcePush();
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
}
