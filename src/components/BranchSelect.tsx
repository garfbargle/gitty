import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ChevronDown, FolderOpen, GitBranch, SquareArrowOutUpRight } from "lucide-react";
import type { WorktreeEntry } from "../types";
import { folderName } from "../lib/git";

type BranchSelectProps = {
  branch: string;
  branches: string[];
  /// Other checkouts of this repository, keyed by branch below.
  worktrees?: WorktreeEntry[];
  disabled?: boolean;
  onBranchChange: (branch: string) => void;
  /// Open another checkout of this repository. Without this the rows can say a
  /// branch lives elsewhere but not take you there.
  onOpenWorktree?: (path: string) => void;
};

/// Choosing a branch, and saying plainly when one is a worktree.
///
/// This was a native <select>, which cannot render an icon or a two-part row,
/// so a worktree arrived as one flat string: "dev/mcp-bridge  →  open
/// gitty-mcp". Two different kinds of thing -- a branch and a directory --
/// joined by an arrow, with nothing to say which token was which. A worktree is
/// a branch *plus a location*, and drawing only the text drops the half that
/// makes it meaningful.
///
/// Every row here shows the branch. A row whose branch is checked out somewhere
/// else also shows that place, as a separate control with its own icon, so the
/// pairing is visible and the two halves can never be read as one name.
export function BranchSelect({
  branch,
  branches,
  worktrees = [],
  disabled,
  onBranchChange,
  onOpenWorktree,
}: BranchSelectProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // branch name -> the checkout holding it, excluding this one.
  const elsewhere = new Map(
    worktrees.filter((entry) => !entry.isCurrent && entry.branch).map((e) => [e.branch as string, e]),
  );

  // A detached checkout has no branch in the list, so nothing would match and
  // the control would name a branch you are not on. State it plainly instead.
  const options = branches.includes(branch) ? branches : [branch, ...branches];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Land on the current branch rather than the top, so opening the list
    // starts where you already are.
    const rows = listRef.current?.querySelectorAll<HTMLButtonElement>(".branch-option");
    const index = Math.max(0, options.indexOf(branch));
    rows?.[index]?.focus();
  }, [open, branch, options]);

  function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>(".branch-option") ?? [])];
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    const step: Record<string, number | "first" | "last"> = {
      ArrowDown: 1,
      ArrowUp: -1,
      Home: "first",
      End: "last",
    };
    const move = step[event.key];
    if (move === undefined) return;
    event.preventDefault();
    if (move === "first") rows[0]?.focus();
    else if (move === "last") rows[rows.length - 1]?.focus();
    else rows[Math.min(rows.length - 1, Math.max(0, current + move))]?.focus();
  }

  const here = elsewhere.get(branch);

  return (
    <div className="branch-select" ref={wrapRef}>
      <button
        type="button"
        className="branch-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((was) => !was)}
        title={here ? `${branch}, checked out in ${here.path}` : branch}
      >
        <GitBranch size={14} className="branch-icon" aria-hidden />
        <span className="branch-select-name">{branch}</span>
        <ChevronDown size={14} className="select-chevron" aria-hidden />
      </button>

      {open ? (
        <div
          className="branch-select-list"
          id={listId}
          role="listbox"
          ref={listRef}
          onKeyDown={onListKeyDown}
        >
          {options.map((name) => {
            const at = elsewhere.get(name);
            const isCurrent = name === branch;
            return (
              <div className={`branch-option-row${isCurrent ? " current" : ""}`} key={name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  className="branch-option"
                  disabled={!!at}
                  title={
                    at
                      ? `${name} is already open in ${at.path}. Git will not check the same branch out twice.`
                      : `Switch to ${name}`
                  }
                  onClick={() => {
                    setOpen(false);
                    onBranchChange(name);
                  }}
                >
                  <GitBranch size={12} aria-hidden />
                  <span className="branch-option-name">{name}</span>
                </button>

                {/* The location half. Its own control, its own icon: a place you
                    can go, not part of the branch's name. */}
                {at ? (
                  <button
                    type="button"
                    className="branch-option-worktree"
                    disabled={!onOpenWorktree}
                    title={`Open the worktree at ${at.path}`}
                    onClick={() => {
                      setOpen(false);
                      onOpenWorktree?.(at.path);
                    }}
                  >
                    <FolderOpen size={11} aria-hidden />
                    {folderName(at.path)}
                    <SquareArrowOutUpRight size={10} aria-hidden />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
