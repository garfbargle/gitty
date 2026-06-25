import { useCallback, useEffect, useRef, useState } from "react";
import { Columns2, Rows2 } from "lucide-react";

export type SplitOrientation = "vertical" | "horizontal";

type SplitPaneProps = {
  className?: string;
  orientation: SplitOrientation;
  onOrientationChange?: (orientation: SplitOrientation) => void;
  split: number;
  onSplitChange: (split: number) => void;
  primary: React.ReactNode;
  secondary: React.ReactNode;
  minSplit?: number;
  maxSplit?: number;
  showLayoutToggle?: boolean;
};

const MIN_SPLIT = 0.15;
const MAX_SPLIT = 0.85;

export function SplitPane({
  className,
  orientation,
  onOrientationChange,
  split,
  onSplitChange,
  primary,
  secondary,
  minSplit = MIN_SPLIT,
  maxSplit = MAX_SPLIT,
  showLayoutToggle = true,
}: SplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const clampSplit = useCallback(
    (value: number) => Math.min(maxSplit, Math.max(minSplit, value)),
    [maxSplit, minSplit],
  );

  useEffect(() => {
    if (!dragging) return;

    function onPointerMove(event: PointerEvent) {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const ratio =
        orientation === "vertical"
          ? (event.clientY - rect.top) / rect.height
          : (event.clientX - rect.left) / rect.width;

      onSplitChange(clampSplit(ratio));
    }

    function onPointerUp() {
      setDragging(false);
    }

    document.body.style.cursor = orientation === "vertical" ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [clampSplit, dragging, onSplitChange, orientation]);

  const primaryStyle =
    orientation === "vertical"
      ? { flex: `0 0 ${split * 100}%` }
      : { flex: `0 0 ${split * 100}%` };

  const toggleLabel =
    orientation === "vertical" ? "Switch to side-by-side layout" : "Switch to stacked layout";

  return (
    <div
      className={`split-pane split-pane-${orientation}${dragging ? " dragging" : ""}${className ? ` ${className}` : ""}`}
      ref={containerRef}
    >
      <div className="split-pane-primary" style={primaryStyle}>
        {primary}
      </div>

      <div
        className="split-divider"
        role="separator"
        aria-orientation={orientation === "vertical" ? "horizontal" : "vertical"}
        aria-valuenow={Math.round(split * 100)}
        aria-valuemin={Math.round(minSplit * 100)}
        aria-valuemax={Math.round(maxSplit * 100)}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          setDragging(true);
        }}
      >
        <span className="split-divider-grip" aria-hidden="true" />
        {showLayoutToggle ? (
          <button
            type="button"
            className="split-layout-toggle icon-btn sm"
            title={toggleLabel}
            aria-label={toggleLabel}
            onClick={() =>
              onOrientationChange?.(orientation === "vertical" ? "horizontal" : "vertical")
            }
            onPointerDown={(event) => event.stopPropagation()}
          >
            {orientation === "vertical" ? <Columns2 size={14} /> : <Rows2 size={14} />}
          </button>
        ) : null}
      </div>

      <div className="split-pane-secondary">{secondary}</div>
    </div>
  );
}
