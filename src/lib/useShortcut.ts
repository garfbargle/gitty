import { useEffect, useRef } from "react";
import { matchesBinding, shortcutById, type ShortcutId } from "./shortcuts";
import { shouldIgnoreKeyboardNavigation } from "./keyboardFocus";

/// Bind a handler to a declared shortcut.
///
/// Handlers name an id rather than testing key and modifiers by hand, so the
/// binding lives in one place and the keyboard reference cannot describe
/// something the app does not do.
///
/// `enabled` is for actions that only apply sometimes -- there is nothing to
/// merge when no repository is open. A disabled shortcut does not listen at
/// all, so it cannot swallow the key from anything else.
export function useShortcut(
  id: ShortcutId,
  handler: () => void,
  options?: { enabled?: boolean; ignoreWhileTyping?: boolean },
) {
  const enabled = options?.enabled ?? true;
  const ignoreWhileTyping = options?.ignoreWhileTyping ?? true;

  // Kept in a ref so a handler that closes over changing state does not have to
  // tear down and re-add the listener on every render.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const shortcut = shortcutById(id);
    const binding = shortcut.binding;
    if (!binding) return;

    function onKeyDown(event: KeyboardEvent) {
      if (!matchesBinding(event, binding!)) return;
      if (ignoreWhileTyping && shouldIgnoreKeyboardNavigation(event)) return;
      event.preventDefault();
      handlerRef.current();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [id, enabled, ignoreWhileTyping]);
}
