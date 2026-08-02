import { ENTER_KEY, MOD_KEY, SHIFT_KEY, shortcut } from "./platform";

/// Every keyboard action in one table.
///
/// The reason this exists rather than a hand-written help sheet: the sheet and
/// the handlers have to come from the same place or they drift, and a keyboard
/// reference that lies is worse than none. Handlers bind by id through
/// `useShortcut`, the sheet renders this table, and the `<kbd>` hints beside
/// buttons read `keys` from here. Adding a binding without documenting it is
/// now the awkward path.

export type ShortcutGroup = "Changes" | "Moving" | "Branches" | "Editing";

/// What has to be true of the KeyboardEvent. `mod` is Command on Apple
/// platforms and Control elsewhere; every handler in the app has always
/// accepted either, so only the printed glyph is platform-specific.
export type Binding = {
  /// Compared case-insensitively against `event.key`.
  key: string;
  mod?: boolean;
  shift?: boolean;
  /// Don't test Shift at all. For keys that are themselves produced by Shift on
  /// some layouts and not others -- "?" is Shift+/ on US, its own key
  /// elsewhere -- so requiring or forbidding Shift would work on one keyboard
  /// and fail on the next. `event.key` is already the resolved character.
  anyShift?: boolean;
};

export type Shortcut = {
  id: ShortcutId;
  group: ShortcutGroup;
  label: string;
  /// How it is written in the sheet and in `<kbd>` hints.
  keys: string;
  /// Absent for actions handled in context rather than globally: Escape closes
  /// whichever dialog is open, arrows move whichever list has focus. They are
  /// real keyboard actions and belong in the reference, but there is no single
  /// global handler to register, and pretending otherwise would either claim
  /// keys the focused control needs or invent a binding nothing listens to.
  binding?: Binding;
};

export type ShortcutId =
  | "stageAll"
  | "commit"
  | "push"
  | "runAction"
  | "toggleSidebar"
  | "mergeIntoMain"
  | "undoEdit"
  | "redoEdit"
  | "timelineMove"
  | "filesMove"
  | "graphMove"
  | "graphJump"
  | "listDismiss"
  | "confirm"
  | "help";

const ARROW_LR = "← →";
const ARROW_UD = "↑ ↓";

export const SHORTCUTS: Shortcut[] = [
  {
    id: "stageAll",
    group: "Changes",
    label: "Stage all changes",
    keys: shortcut(MOD_KEY, "A"),
    binding: { key: "a", mod: true },
  },
  {
    id: "commit",
    group: "Changes",
    label: "Commit staged changes",
    keys: shortcut(MOD_KEY, ENTER_KEY),
    binding: { key: "Enter", mod: true },
  },
  {
    id: "push",
    group: "Changes",
    label: "Push",
    keys: shortcut(MOD_KEY, SHIFT_KEY, ENTER_KEY),
    binding: { key: "Enter", mod: true, shift: true },
  },
  {
    id: "runAction",
    group: "Changes",
    label: "Run the selected action",
    keys: shortcut(MOD_KEY, "R"),
    binding: { key: "r", mod: true },
  },

  {
    id: "help",
    group: "Moving",
    label: "This list",
    keys: "?",
    binding: { key: "?", anyShift: true },
  },
  {
    id: "timelineMove",
    group: "Moving",
    label: "Along the timeline",
    keys: ARROW_LR,
  },
  {
    id: "filesMove",
    group: "Moving",
    label: "Into and through the changed files",
    keys: ARROW_UD,
  },
  {
    id: "graphMove",
    group: "Moving",
    label: "Through the branch graph and the branch list",
    keys: ARROW_UD,
  },
  {
    id: "graphJump",
    group: "Moving",
    label: "Jump to the top or bottom of a list",
    keys: "Home / End",
  },
  {
    id: "listDismiss",
    group: "Moving",
    label: "Close a list, dialog, or preview",
    keys: "Esc",
  },
  {
    id: "confirm",
    group: "Moving",
    label: "Confirm a dialog",
    keys: ENTER_KEY,
  },

  {
    id: "toggleSidebar",
    group: "Branches",
    label: "Show or hide the repositories list",
    keys: shortcut(MOD_KEY, "B"),
    binding: { key: "b", mod: true },
  },
  {
    id: "mergeIntoMain",
    group: "Branches",
    label: "Merge into main",
    keys: shortcut(MOD_KEY, "M"),
    binding: { key: "m", mod: true },
  },

  {
    id: "undoEdit",
    group: "Editing",
    // Named precisely on purpose: this is not a general undo, and someone who
    // reads it as one will press it expecting a commit to come back.
    label: "Undo an inline line edit",
    keys: shortcut(MOD_KEY, "Z"),
    binding: { key: "z", mod: true },
  },
  {
    id: "redoEdit",
    group: "Editing",
    label: "Redo an inline line edit",
    keys: shortcut(MOD_KEY, SHIFT_KEY, "Z"),
    binding: { key: "z", mod: true, shift: true },
  },
];

export const GROUP_ORDER: ShortcutGroup[] = ["Changes", "Moving", "Branches", "Editing"];

const BY_ID = new Map(SHORTCUTS.map((entry) => [entry.id, entry]));

export function shortcutById(id: ShortcutId): Shortcut {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown shortcut: ${id}`);
  return found;
}

/// The printed form, for a `<kbd>` beside the control it belongs to.
export function shortcutKeys(id: ShortcutId): string {
  return shortcutById(id).keys;
}

/// Whether this event is the given binding.
///
/// Modifiers are checked exactly rather than loosely: without the negative
/// tests, Mod+Shift+Z also satisfies Mod+Z and both undo and redo would fire on
/// one press.
export function matchesBinding(event: KeyboardEvent, binding: Binding): boolean {
  const mod = event.metaKey || event.ctrlKey;
  if (!!binding.mod !== mod) return false;
  if (!binding.anyShift && !!binding.shift !== event.shiftKey) return false;
  if (event.altKey) return false;
  return event.key.toLowerCase() === binding.key.toLowerCase();
}

/// Back-compatible view for the existing `<kbd>` call sites.
export const SHORTCUT = {
  stageAll: shortcutKeys("stageAll"),
  commit: shortcutKeys("commit"),
  push: shortcutKeys("push"),
  confirm: shortcutKeys("confirm"),
} as const;
