/// The pull half of the window-inset plumbing whose push half is the
/// `setOnApplyWindowInsetsListener` in MainActivity.kt.
///
/// wry calls `setContentView` and then `loadUrl`, so the first inset pass runs
/// while the webview is still on about:blank and the push made there evaluates
/// against a document that is thrown away. Every later change -- folding,
/// rotating, docking to DeX, the keyboard -- pushes fine. It is only the first
/// one that needs collecting, which is what this does.
///
/// Nothing here runs on desktop: the bridge is only installed by the Android
/// activity, and the properties keep the 0px defaults declared in App.css.

type Insets = { top: number; right: number; bottom: number; left: number };

const BRIDGE = "__gittyAndroidInsets";

type InsetBridge = { insets: () => string };

function readBridge(): Insets | null {
  const bridge = (window as unknown as Record<string, InsetBridge | undefined>)[BRIDGE];
  if (!bridge || typeof bridge.insets !== "function") return null;
  try {
    const parsed: unknown = JSON.parse(bridge.insets());
    if (!parsed || typeof parsed !== "object") return null;
    const { top, right, bottom, left } = parsed as Partial<Insets>;
    if (
      typeof top !== "number" ||
      typeof right !== "number" ||
      typeof bottom !== "number" ||
      typeof left !== "number"
    ) {
      return null;
    }
    return { top, right, bottom, left };
  } catch {
    // A bridge that answers with something unparseable is not worth failing
    // startup over; the 0px defaults are a survivable layout.
    return null;
  }
}

export function seedAndroidInsets(): void {
  const insets = readBridge();
  if (!insets) return;
  const root = document.documentElement;
  root.style.setProperty("--android-inset-top", `${insets.top}px`);
  root.style.setProperty("--android-inset-right", `${insets.right}px`);
  root.style.setProperty("--android-inset-bottom", `${insets.bottom}px`);
  root.style.setProperty("--android-inset-left", `${insets.left}px`);
}
