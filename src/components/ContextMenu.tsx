import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem = {
  label: string;
  onClick: () => void;
};

type ContextMenuProps = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

/// Clearance between the menu and the edge of the usable screen.
const EDGE_GAP = 8;

function inset(name: string): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: y, left: x });

  // The menu opens at a point the user chose, which near an edge is a point the
  // menu does not fit at. Clamping needs the rendered size, so it happens after
  // the first layout -- in a layout effect rather than an effect, so the
  // corrected position is in place before the browser paints and the menu does
  // not appear to jump.
  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!node) return;
    const { width, height } = node.getBoundingClientRect();
    // The system bars are part of the window but not part of the screen the
    // user can reach; a menu clamped to the raw viewport would still land under
    // the gesture handle.
    const minLeft = inset("--android-inset-left") + EDGE_GAP;
    const minTop = inset("--android-inset-top") + EDGE_GAP;
    const maxLeft = window.innerWidth - inset("--android-inset-right") - EDGE_GAP - width;
    const maxTop = window.innerHeight - inset("--android-inset-bottom") - EDGE_GAP - height;
    setPosition({
      // `Math.max` last, so a menu larger than the space available is pinned to
      // the top-left corner and scrolls rather than being pushed off the start.
      left: Math.max(minLeft, Math.min(x, maxLeft)),
      top: Math.max(minTop, Math.min(y, maxTop)),
    });
  }, [x, y, items]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as HTMLElement;
      if (target.closest(".context-menu")) return;
      onClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    function handleScroll() {
      onClose();
    }

    // `pointerdown`, not `mousedown`: Android only synthesises a mouse event
    // once it has decided the touch was not the start of a scroll, so a tap
    // outside could leave the menu open.
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="context-menu"
      ref={menuRef}
      role="menu"
      style={{ top: position.top, left: position.left }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="context-menu-item"
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
