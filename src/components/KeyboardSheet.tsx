import { useEffect } from "react";
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
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="keyboard-sheet-scrim" role="presentation" onClick={onClose}>
      <div
        className="keyboard-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="keyboard-sheet-head">
          <h2>Keyboard</h2>
          <button type="button" className="keyboard-sheet-close" onClick={onClose}>
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
