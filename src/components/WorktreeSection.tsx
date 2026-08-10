import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, Loader2, Lock, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import type { ActionResult, WorktreeCleanupEntry, WorktreeEntry } from "../types";
import { shortenPath } from "../lib/git";
import { revealInFinder } from "../lib/finder";

type WorktreeSectionProps = {
  repoPath: string;
  disabled?: boolean;
  /// Owned by App so the chip row and this panel cannot disagree. Adding a
  /// worktree here used to leave the row showing a stale count until something
  /// unrelated happened to refresh it.
  worktrees: WorktreeEntry[];
  /// Per-folder judgement of what would be lost by removing it. Owned by the
  /// drawer, which also shows the count at the top — this panel is the bottom
  /// of a long scroll.
  cleanup: WorktreeCleanupEntry[];
  /// Open the review list. Nothing is removed without going through it.
  onReviewCleanup: () => void;
  /// Re-read the list after this panel mutates it.
  onWorktreesChanged: () => void;
  /// Switch Gitty to another checkout of the same repository.
  onOpenWorktree?: (path: string) => void;
  /// Confirm removing a checkout before its folder is deleted.
  onConfirmRemove: (worktree: WorktreeEntry) => void;
};

/// Managing the repository's other checkouts.
///
/// One word for the concept, everywhere: "folder". It was "Workspaces" here,
/// "Folder" in the context row and "open in" in the branch switcher, which is
/// three names for one thing across three surfaces. The git term stays in the
/// helper text so anyone who came looking for "worktree" still finds it.
export function WorktreeSection({
  repoPath,
  disabled,
  worktrees,
  cleanup,
  onReviewCleanup,
  onWorktreesChanged,
  onOpenWorktree,
  onConfirmRemove,
}: WorktreeSectionProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ branch: "", directory: "", createBranch: false });

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await action();
      onWorktreesChanged();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }

  const controlsDisabled = disabled || busy !== null;
  const others = worktrees.filter((entry) => !entry.isCurrent);
  const finished = cleanup.filter((entry) => entry.verdict === "safe");
  const maybeFinished = cleanup.filter((entry) => entry.verdict === "probably");
  const reviewable = finished.length + maybeFinished.length;
  const judged = new Map(cleanup.map((entry) => [entry.path, entry] as const));

  return (
    <div className="settings-field">
      <div className="settings-field-head">
        <label>Folders</label>
        <div className="settings-field-head-actions">
          {/* The review covers folders git has lost track of too, so the bare
              prune only shows when there is no review to offer. */}
          {worktrees.some((entry) => entry.prunable) && reviewable === 0 ? (
            <button
              type="button"
              className="settings-inline-link"
              disabled={controlsDisabled}
              title="Forget folders that are no longer on disk"
              onClick={() => void run("prune", () => invoke<ActionResult>("prune_worktrees", { path: repoPath }))}
            >
              {busy === "prune" ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
              Clean up
            </button>
          ) : null}
          <button
            type="button"
            className="settings-inline-link"
            disabled={controlsDisabled || adding}
            onClick={() => {
              setDraft({ branch: "", directory: "", createBranch: false });
              setAdding(true);
            }}
          >
            <Plus size={12} />
            Add folder
          </button>
        </div>
      </div>

      <p className="settings-hint">
        Keep more than one branch open at once, each in its own folder, so you can switch without
        stashing. These are git worktrees.
      </p>

      {reviewable > 0 ? (
        <div className="cleanup-banner">
          <Sparkles size={14} />
          <span className="cleanup-banner-copy">
            <strong>
              {finished.length > 0
                ? `${finished.length} ${finished.length === 1 ? "folder looks" : "folders look"} finished.`
                : `${maybeFinished.length} ${maybeFinished.length === 1 ? "folder may be" : "folders may be"} finished with.`}
            </strong>
            <span>Nothing in them would be lost. Gitty can walk you through removing them.</span>
          </span>
          <button
            type="button"
            className="settings-btn"
            disabled={controlsDisabled}
            onClick={onReviewCleanup}
          >
            Review
          </button>
        </div>
      ) : null}

      {adding ? (
        <div className="subtree-add-form">
          <input
            className="settings-input settings-input-compact"
            value={draft.branch}
            onChange={(event) => setDraft((d) => ({ ...d, branch: event.currentTarget.value }))}
            placeholder="branch, e.g. feature/login"
            aria-label="Branch"
            autoFocus
            spellCheck={false}
          />
          <input
            className="settings-input"
            value={draft.directory}
            onChange={(event) => setDraft((d) => ({ ...d, directory: event.currentTarget.value }))}
            placeholder="new folder, e.g. ~/Projects/app-login"
            aria-label="Folder"
            spellCheck={false}
          />
          <label className="settings-check">
            <input
              type="checkbox"
              checked={draft.createBranch}
              onChange={(event) => setDraft((d) => ({ ...d, createBranch: event.currentTarget.checked }))}
            />
            Start a new branch here
          </label>
          <div className="subtree-add-actions">
            <button
              type="button"
              className="settings-btn"
              disabled={controlsDisabled}
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="settings-btn primary"
              disabled={controlsDisabled || !draft.branch.trim() || !draft.directory.trim()}
              onClick={() =>
                void run("add", async () => {
                  await invoke<string>("add_worktree", {
                    path: repoPath,
                    directory: draft.directory.trim(),
                    branch: draft.branch.trim(),
                    createBranch: draft.createBranch,
                  });
                  setAdding(false);
                })
              }
            >
              {busy === "add" ? <Loader2 size={12} className="spin" /> : null}
              Create
            </button>
          </div>
        </div>
      ) : null}

      {others.length === 0 && !adding ? (
        <p className="settings-hint">
          This repository has one folder. Add a folder to work on another branch alongside it.
        </p>
      ) : null}

      <ul className="worktree-list">
        {worktrees.map((entry) => (
          <li key={entry.path} className={`worktree-item${entry.isCurrent ? " current" : ""}`}>
            <div className="worktree-text">
              <span className="worktree-branch">
                {entry.branch ?? `detached at ${entry.head.slice(0, 7)}`}
                {entry.isMain ? <em className="worktree-badge">main folder</em> : null}
                {entry.isCurrent ? <em className="worktree-badge current">open now</em> : null}
                {judged.get(entry.path)?.verdict === "safe" && !entry.prunable ? (
                  <em className="worktree-badge finished" title={judged.get(entry.path)?.reason}>
                    finished
                  </em>
                ) : null}
                {entry.locked ? (
                  <em className="worktree-badge" title="Locked">
                    <Lock size={10} /> locked
                  </em>
                ) : null}
                {entry.prunable ? (
                  <em className="worktree-badge missing" title="Folder is gone from disk">
                    missing
                  </em>
                ) : null}
              </span>
              <small title={entry.path}>{shortenPath(entry.path)}</small>
            </div>
            <div className="worktree-actions">
              {!entry.isCurrent && onOpenWorktree && !entry.prunable ? (
                <button
                  type="button"
                  className="settings-inline-link"
                  disabled={controlsDisabled}
                  title="Open this folder in Gitty"
                  onClick={() => onOpenWorktree(entry.path)}
                >
                  Open
                </button>
              ) : null}
              {/* A prunable entry is one git still remembers but whose folder
                  is gone, so revealing it would open nothing and say nothing
                  about why. "Clean up" is the action that applies to it. */}
              {!entry.prunable ? (
                <button
                  type="button"
                  className="settings-inline-link"
                  disabled={controlsDisabled}
                  title="Reveal in Finder"
                  onClick={() => void revealInFinder(entry.path)}
                >
                  <FolderOpen size={12} />
                </button>
              ) : null}
              {!entry.isMain && !entry.isCurrent ? (
                <button
                  type="button"
                  className="settings-inline-link danger"
                  disabled={controlsDisabled}
                  title="Remove this folder"
                  onClick={() => onConfirmRemove(entry)}
                >
                  <Trash2 size={12} />
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {error ? <p className="settings-error">{error}</p> : null}
    </div>
  );
}
