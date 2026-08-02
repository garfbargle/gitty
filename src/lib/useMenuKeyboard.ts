import { useEffect, type RefObject } from "react";

/// Keyboard behaviour for a `role="menu"` popup.
///
/// Five buttons in this app open a menu, and all five declared the role
/// without implementing what the role promises: no arrow-key movement between
/// items, no focus moved into the menu when it opens, and no focus returned to
/// the trigger when it closes. Items were reachable only by tabbing through
/// DOM order, and closing a menu left focus on a removed element, which drops
/// it to `<body>` — so a keyboard user lost their place in the toolbar every
/// time they pressed Escape.
///
/// This is one hook rather than five copies of the same effect, because the
/// five had already drifted: some closed on Escape, none restored focus, and
/// the two linked-folder menus differed from the two push/pull menus in which
/// events they listened for.
///
/// Roving focus is deliberately real `.focus()` movement rather than
/// `aria-activedescendant`. The items are ordinary buttons, so moving focus is
/// what makes Enter and Space work without re-implementing activation.
export function useMenuKeyboard({
  open,
  setOpen,
  rootRef,
  triggerSelector = "button",
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  rootRef: RefObject<HTMLElement | null>;
  /// What to return focus to when the menu closes. Defaults to the first
  /// button in the group, which is the primary action in every current caller.
  triggerSelector?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root) return;

    const items = () =>
      [...root.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];

    // Opening a menu with the keyboard should land you in it. Without this the
    // menu appears and focus stays on the trigger, so the first arrow press
    // does nothing and Tab walks into whatever follows the group in the DOM.
    const first = items()[0];
    first?.focus();

    const restore = () => {
      root.querySelector<HTMLElement>(triggerSelector)?.focus();
    };

    function onKeyDown(event: KeyboardEvent) {
      const list = items();
      if (list.length === 0) return;
      const current = list.indexOf(document.activeElement as HTMLElement);

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          list[current < 0 || current === list.length - 1 ? 0 : current + 1]?.focus();
          break;
        case "ArrowUp":
          event.preventDefault();
          list[current <= 0 ? list.length - 1 : current - 1]?.focus();
          break;
        case "Home":
          event.preventDefault();
          list[0]?.focus();
          break;
        case "End":
          event.preventDefault();
          list[list.length - 1]?.focus();
          break;
        case "Escape":
          event.preventDefault();
          setOpen(false);
          restore();
          break;
        case "Tab":
          // Tabbing out is a legitimate way to leave a menu, but the menu must
          // go with you rather than staying open behind the focus ring.
          setOpen(false);
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen, rootRef, triggerSelector]);
}
