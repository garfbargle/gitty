import { useCallback, useLayoutEffect, useRef, useState } from "react";

const HIDDEN_CLASS = "is-overflowed";

/// The text of an item, for the "+N" menu and its accessible name.
///
/// Joined from the child elements rather than read off `textContent`, because
/// the parts of a chip are separate spans with no whitespace between them:
/// `textContent` alone produced "Remoteorigin/main2 to merge". `innerText`
/// would insert the separators but returns "" once the element is hidden,
/// which is exactly when this is needed.
function readLabel(el: HTMLElement): string {
  const parts = [...el.children]
    .map((child) => (child.textContent ?? "").trim())
    .filter(Boolean);
  const text = parts.length > 0 ? parts.join(" ") : (el.textContent ?? "");
  return text.replace(/\s+/g, " ").trim();
}

/// Collapse whatever does not fit on one line into a trailing "+N".
///
/// This replaces a set of container-query breakpoints that hid chips at fixed
/// widths. Width was always the wrong signal: the row overflows because of how
/// much its contents *say*, not how wide the window is, so a repository with
/// one long branch name crowded a wide window while a repository with short
/// ones lost chips it had room for. Two of those breakpoints also hid buttons
/// rather than decoration, so narrowing the window silently removed the only
/// way to reach another checkout.
///
/// Items are kept in the DOM and hidden with a class rather than unmounted, so
/// their natural widths stay measurable and the caller keeps one render path.
/// Natural widths are cached and only re-measured when `signature` changes,
/// because measuring requires briefly showing everything, and doing that on
/// every resize frame is what makes this kind of hook flicker.
export function usePriorityPlus(signature: string) {
  const ref = useRef<HTMLElement | null>(null);
  const widthsRef = useRef<number[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);

  const measure = useCallback(() => {
    const root = ref.current;
    if (!root) return;
    const items = [...root.children].filter(
      (el): el is HTMLElement => el instanceof HTMLElement && !el.dataset.overflowAnchor,
    );
    if (items.length === 0) return;

    if (widthsRef.current.length !== items.length) {
      const restore = items.map((el) => el.classList.contains(HIDDEN_CLASS));
      items.forEach((el) => el.classList.remove(HIDDEN_CLASS));
      widthsRef.current = items.map((el) => el.getBoundingClientRect().width);
      items.forEach((el, i) => {
        if (restore[i]) el.classList.add(HIDDEN_CLASS);
      });
    }

    const widths = widthsRef.current;
    const style = getComputedStyle(root);
    const gap = parseFloat(style.columnGap || style.gap || "0") || 0;
    const available = root.clientWidth;

    const total = widths.reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1);
    let fits = widths.length;
    if (total > available) {
      // Everything past the first is droppable, but never the first: it is the
      // branch you are standing on, and a row that cannot say that has failed
      // at the one thing it exists for.
      const anchorWidth = 46; // the "+N" control
      let used = 0;
      fits = 0;
      for (let i = 0; i < widths.length; i += 1) {
        const next = used + widths[i] + (i > 0 ? gap : 0);
        if (next + gap + anchorWidth > available) break;
        used = next;
        fits += 1;
      }
      fits = Math.max(1, fits);
    }

    const labels: string[] = [];
    items.forEach((el, i) => {
      const over = i >= fits;
      el.classList.toggle(HIDDEN_CLASS, over);
      if (over) labels.push(readLabel(el));
    });

    setHidden((current) =>
      current.length === labels.length && current.every((v, i) => v === labels[i])
        ? current
        : labels,
    );
  }, []);

  useLayoutEffect(() => {
    widthsRef.current = [];
    measure();
  }, [signature, measure]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);

  return { ref, hidden };
}
