/// Long press as the touch equivalent of a right click.
///
/// Several menus in the app are reachable only through `onContextMenu` -- the
/// per-file actions in the changes list, the repository actions in the sidebar,
/// the branch/reset/tag actions on a commit. A touchscreen has no second button,
/// so on Android those menus could not be opened at all and the actions inside
/// them had no other entry point.
///
/// The hook hands back a `bind` rather than the handlers themselves. These
/// menus are attached to rows inside a `.map`, and a hook called per row would
/// change the hook count with the number of files in the diff. One timer is
/// enough regardless: a long press is a single-pointer gesture, so there is
/// never a second one in flight to track.

import { useCallback, useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

/// Long enough not to fire on a tap that lingers, short enough to feel like a
/// press rather than a wait. Matches the platform's own ~500ms.
const HOLD_MS = 500;
/// A finger never holds perfectly still. Past this the gesture was a scroll.
const MOVE_TOLERANCE_PX = 10;

export type LongPressPoint = { x: number; y: number };

export type LongPressHandlers = {
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
  onPointerCancel: (event: ReactPointerEvent) => void;
  onClickCapture: (event: ReactMouseEvent) => void;
};

export function useLongPress(): (
  handler: (point: LongPressPoint) => void,
) => LongPressHandlers {
  const timerRef = useRef<number | null>(null);
  const originRef = useRef<LongPressPoint | null>(null);
  // Which pointer started the press. Movement belongs to a specific pointer,
  // and in DeX a mouse sitting anywhere on the page emits its own moves; without
  // this check any of them would read as the finger sliding and cancel the
  // gesture before it completed.
  const pointerIdRef = useRef<number | null>(null);
  // Survives past the press so the click that Android synthesises afterwards
  // can be swallowed. Without it, pressing a file row opens the menu and
  // selects the file underneath it at the same time.
  const firedRef = useRef(false);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
    pointerIdRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return useCallback(
    (handler: (point: LongPressPoint) => void): LongPressHandlers => ({
      onPointerDown(event) {
        // A mouse already has a right button, and holding the left one down is
        // the start of a drag or a selection, not a request for a menu. This is
        // also what keeps the gesture out of the way in DeX.
        if (event.pointerType === "mouse") return;
        cancel();
        firedRef.current = false;
        const point = { x: event.clientX, y: event.clientY };
        originRef.current = point;
        pointerIdRef.current = event.pointerId;
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          firedRef.current = true;
          handler(point);
        }, HOLD_MS);
      },
      onPointerMove(event) {
        const origin = originRef.current;
        if (!origin || event.pointerId !== pointerIdRef.current) return;
        if (
          Math.abs(event.clientX - origin.x) > MOVE_TOLERANCE_PX ||
          Math.abs(event.clientY - origin.y) > MOVE_TOLERANCE_PX
        ) {
          cancel();
        }
      },
      onPointerUp(event) {
        if (event.pointerId === pointerIdRef.current) cancel();
      },
      onPointerCancel(event) {
        if (event.pointerId === pointerIdRef.current) cancel();
      },
      onClickCapture(event) {
        if (!firedRef.current) return;
        firedRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
    }),
    [cancel],
  );
}
