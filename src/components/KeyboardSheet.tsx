import { useEffect, useRef } from "react";
import { GROUP_ORDER, SHORTCUTS } from "../lib/shortcuts";
import "./KeyboardSheet.css";

type KeyboardSheetProps = {
  open: boolean;
  onClose: () => void;
};

/// What every key does, in the app rather than in the README.
///
/// The README's first line calls Gitty keyboard-first, and until now four of
/// eleven actions were written down, in a file you never see while using it.
/// Merge into main had no printed form anywhere.
///
/// Rendered from the same table the handlers bind against, so it cannot
/// describe a key the app does not have, or miss one it does.
export function KeyboardSheet({ open, onClose }: KeyboardSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  /// `aria-modal="true"` tells assistive tech to ignore everything outside this
  /// dialog. Focus was never moved into it, so a screen-reader user ended up
  /// with focus in a subtree their own AT had just been told to ignore, and Tab
  /// walked into the page behind the scrim. Moving focus in, keeping it in, and
  /// putting it back where it came from is what the role was already promising.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () =>
      [
        ...(sheetRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ].filter((el) => !el.hasAttribute("disabled"));

    focusables()[0]?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      // Wrap at both ends rather than letting Tab leave a modal dialog.
      if (event.shiftKey && (active === first || !sheetRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      // Back to whatever opened it, not to <body>.
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="keyboard-sheet-scrim" role="presentation" onClick={onClose}>
      <div
        className="keyboard-sheet"
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="keyboard-sheet-head">
          <h2>Keyboard</h2>
          <button type="button" className="keyboard-sheet-close" onClick={onClose} aria-label="Close">
            Esc
          </button>
        </header>

        <div className="keyboard-sheet-groups">
          {GROUP_ORDER.map((group) => {
            const rows = SHORTCUTS.filter((entry) => entry.group === group);
            if (rows.length === 0) return null;
            return (
              <section className="keyboard-sheet-group" key={group}>
                <h3>{group}</h3>
                <dl>
                  {rows.map((entry) => (
                    <div className="keyboard-sheet-row" key={entry.id}>
                      <dt>
                        <kbd>{entry.keys}</kbd>
                      </dt>
                      <dd>{entry.label}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>

        <p className="keyboard-sheet-note">
          Text fields keep their own keys, so nothing here fires while you are typing a
          message.
        </p>
      </div>
    </div>
  );
}
