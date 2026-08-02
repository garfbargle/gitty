import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, Loader2, Lock, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { ActionResult, WorktreeEntry } from "../types";
import { shortenPath } from "../lib/git";
import { revealInFinder } from "../lib/finder";

type WorktreeSectionProps = {
  repoPath: string;
  disabled?: boolean;
  /// Switch Gitty to another checkout of the same repository.
  onOpenWorktree?: (path: string) => void;
};

/// Managing the repository's other checkouts.
///
/// Named "workspaces" rather than "worktrees" to hold the line on git
/// vocabulary in SIMPLIFICATION_PLAN.md, with the git term in the helper text
/// so anyone who came looking for it still finds it.
export function WorktreeSection({ repoPath, disabled, onOpenWorktree }: WorktreeSectionProps) {
  const [worktrees, setWorktrees] = useState<WorktreeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ branch: "", directory: "", createBranch: false });

  const load = useCallback(async () => {
    if (!repoPath) return;
    try {
      const result = await invoke<WorktreeEntry[]>("list_worktrees", { path: repoPath });
      // Gitty's own scratch checkouts are an implementation detail of merging
      // and commit previews, not something the user made.
      setWorktrees(result.filter((entry) => !entry.internal));
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [repoPath]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }

  const controlsDisabled = disabled || busy !== null;
  const others = worktrees?.filter((entry) => !entry.isCurrent) ?? [];

  return (
    <div className="settings-field">
      <div className="settings-field-head">
        <label>Workspaces</label>
        <div className="settings-field-head-actions">
          {worktrees && worktrees.some((entry) => entry.prunable) ? (
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
            Add workspace
          </button>
        </div>
      </div>

      <p className="settings-hint">
        Keep more than one branch open at once, each in its own folder, so you can switch without
        stashing. These are git worktrees.
      </p>

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

      {worktrees === null ? (
        <p className="settings-hint">Loading…</p>
      ) : others.length === 0 && !adding ? (
        <p className="settings-hint">
          This repository has one folder. Add a workspace to work on another branch alongside it.
        </p>
      ) : null}

      <ul className="worktree-list">
        {worktrees?.map((entry) => (
          <li key={entry.path} className={`worktree-item${entry.isCurrent ? " current" : ""}`}>
            <div className="worktree-text">
              <span className="worktree-branch">
                {entry.branch ?? `detached at ${entry.head.slice(0, 7)}`}
                {entry.isMain ? <em className="worktree-badge">main folder</em> : null}
                {entry.isCurrent ? <em className="worktree-badge current">open now</em> : null}
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
              <button
                type="button"
                className="settings-inline-link"
                disabled={controlsDisabled}
                title="Reveal in Finder"
                onClick={() => void revealInFinder(entry.path)}
              >
                <FolderOpen size={12} />
              </button>
              {!entry.isMain && !entry.isCurrent ? (
                <button
                  type="button"
                  className="settings-inline-link danger"
                  disabled={controlsDisabled}
                  title="Remove this workspace and delete its folder"
                  onClick={() =>
                    void run(`remove-${entry.path}`, () =>
                      invoke<ActionResult>("remove_worktree", {
                        path: repoPath,
                        worktree: entry.path,
                      }),
                    )
                  }
                >
                  {busy === `remove-${entry.path}` ? (
                    <Loader2 size={12} className="spin" />
                  ) : (
                    <Trash2 size={12} />
                  )}
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
