/// Whether the focused element owns the keystroke.
///
/// Text entry keeps its own keys: without this, Mod+A inside the commit message
/// stages the working tree instead of selecting the text. Checkboxes are the
/// deliberate exception -- they are inputs, but they do not consume typing, and
/// treating them as text entry would disable the shortcuts while a file's stage
/// checkbox happens to hold focus.
///
/// Lives here rather than in App.tsx so `useShortcut` can apply the same rule.
/// Two guards that disagree is how a shortcut ends up firing in one place and
/// not another.
export function shouldIgnoreKeyboardNavigation(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target || !target.tagName) return false;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const input = target as HTMLInputElement;
    if (input.type !== "checkbox") return true;
  }
  if (target.isContentEditable) return true;
  return false;
}

/// Enter additionally belongs to a focused button, which would otherwise be
/// activated and run the shortcut in the same press.
export function shouldIgnoreEnterShortcut(event: KeyboardEvent): boolean {
  if (shouldIgnoreKeyboardNavigation(event)) return true;
  return (event.target as HTMLElement | null)?.tagName === "BUTTON";
}
