/// Keyboard hints have to name the key the user actually has. Every shortcut
/// handler in the app already accepts `metaKey || ctrlKey`, so the behaviour is
/// correct everywhere; only the printed glyph was macOS-only.

function detectApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  // `userAgentData.platform` is the non-deprecated source where it exists;
  // `platform` remains the only option in WebKit.
  const uaPlatform = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  const platform = uaPlatform || navigator.platform || navigator.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export const isApplePlatform = detectApplePlatform();

/// The "Mod" key: Command on Apple platforms, Control everywhere else.
export const MOD_KEY = isApplePlatform ? "⌘" : "Ctrl";
export const SHIFT_KEY = isApplePlatform ? "⇧" : "Shift";
export const ENTER_KEY = isApplePlatform ? "↵" : "Enter";

/// Apple glyphs read as a single token (`⌘⇧↵`); word-based modifiers need
/// separators to stay legible (`Ctrl+Shift+Enter`).
export function shortcut(...parts: string[]): string {
  return isApplePlatform ? parts.join("") : parts.join("+");
}

/// The SHORTCUT table moved to lib/shortcuts.ts, where the printed form sits
/// beside the binding the handlers use. Keeping a second copy here is how a
/// hint and its handler drift apart.
