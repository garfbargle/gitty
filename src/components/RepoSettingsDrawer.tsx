import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Download,
  FolderGit2,
  ImageOff,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type {
  LinkedFolder,
  RemoteEntry,
  WorktreeCleanupEntry,
  WorktreeCleanupOutcome,
  WorktreeEntry,
} from "../types";
import { SettingsModal } from "./SettingsModal";
import { RepoIcon } from "./RepoIcon";
import { WorktreeSection } from "./WorktreeSection";
import { WorktreeCleanupDialog } from "./WorktreeCleanupDialog";
import { clearRepoIcon, listRepoImages, setRepoIcon, type RepoImage } from "../lib/repoIcons";
import {
  addLinkedFolder,
  checkSubtreeUpdates,
  listLinkedFolders,
  pushLinkedFolder,
  removeLinkedFolder,
  setLinkedFolderSource,
} from "../lib/subtrees";

type RemoteDraft = {
  id: string;
  name: string;
  url: string;
  existed: boolean;
};

type RepoSettingsDrawerProps = {
  open: boolean;
  repoName: string;
  repoPath: string;
  remotes: RemoteEntry[];
  onClose: () => void;
  onSaveRemote: (name: string, url: string) => Promise<boolean>;
  onRemoveRemote: (name: string) => Promise<boolean>;
  onFetch: () => void;
  onRemoveRepo: () => void;
  /// Pull a linked folder from its source. Owns conflict handling (may close this
  /// drawer to show the resolver) and refreshing the repo.
  onUpdateFolder: (prefix: string) => Promise<void>;
  /// Switch Gitty to another checkout of the same repository.
  onOpenWorktree?: (path: string) => void;
  /// Owned by App so this panel and the context row cannot disagree.
  worktrees: WorktreeEntry[];
  onWorktreesChanged: () => void;
  onConfirmRemove: (worktree: WorktreeEntry) => void;
  backupAvailable: boolean;
  backupOnPush: boolean;
  hasBackupRemote: boolean;
  onBackupOnPushChange: (enabled: boolean) => Promise<boolean>;
  disabled?: boolean;
};

/// Shorten a clone URL to something readable: "github.com/acme/ui-kit".
function prettySource(url: string): string {
  if (!url) return "source unknown";
  return url
    .replace(/^git@/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^ssh:\/\//, "")
    .replace(":", "/")
    .replace(/\.git$/, "");
}

/// Normalize a clone URL so `git@host:a/b.git` and `https://host/a/b` compare
/// equal — used to tell whether a git remote is really just a linked folder's
/// backing source (and so shouldn't clutter the Remote URL list).
function canonicalUrl(url: string): string {
  return url
    .trim()
    .replace(/^git@/, "")
    .replace(/^https?:\/\//, "")
    .replace(/^ssh:\/\//, "")
    .replace(/^git:\/\//, "")
    .replace(":", "/")
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function uniqueRemotes(remotes: RemoteEntry[]) {
  const unique = new Map<string, RemoteEntry>();
  remotes.forEach((remote) => {
    if (remote.kind === "fetch" || !unique.has(remote.name)) {
      unique.set(remote.name, remote);
    }
  });
  return Array.from(unique.values());
}

function remotesToDrafts(remotes: RemoteEntry[]): RemoteDraft[] {
  const listed = uniqueRemotes(remotes);
  if (listed.length === 0) {
    return [{ id: "new-origin", name: "origin", url: "", existed: false }];
  }
  return listed.map((remote) => ({
    id: remote.name,
    name: remote.name,
    url: remote.url,
    existed: true,
  }));
}

function draftsDirty(original: RemoteDraft[], current: RemoteDraft[]) {
  if (original.length !== current.length) return true;
  return current.some((draft, index) => {
    const base = original[index];
    return draft.name.trim() !== base.name.trim() || draft.url.trim() !== base.url.trim();
  });
}

function validDrafts(drafts: RemoteDraft[]) {
  return drafts.filter((draft) => draft.name.trim() && draft.url.trim());
}

function RepoIconSection({
  open,
  repoName,
  repoPath,
  disabled,
}: {
  open: boolean;
  repoName: string;
  repoPath: string;
  disabled?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const [images, setImages] = useState<RepoImage[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPicking(false);
      setImages(null);
      setError(null);
    }
  }, [open, repoPath]);

  async function togglePicker() {
    if (picking) {
      setPicking(false);
      return;
    }
    setPicking(true);
    setError(null);
    if (images) return;

    setLoading(true);
    try {
      setImages(await listRepoImages(repoPath));
    } catch (err) {
      setError(String(err));
      setImages([]);
    } finally {
      setLoading(false);
    }
  }

  async function choose(relativePath: string) {
    setBusy(true);
    setError(null);
    try {
      await setRepoIcon(repoPath, relativePath);
      setPicking(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function useAutomatic() {
    setBusy(true);
    setError(null);
    try {
      await clearRepoIcon(repoPath);
      setPicking(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  const controlsDisabled = disabled || busy;

  return (
    <div className="settings-field">
      <label>Icon</label>
      <div className="settings-icon-row">
        <RepoIcon path={repoPath} name={repoName} size={44} className="settings-icon-preview" />
        <div className="settings-icon-actions">
          <button
            type="button"
            className="settings-btn"
            disabled={controlsDisabled}
            onClick={() => void togglePicker()}
          >
            {picking ? "Cancel" : "Choose from repo…"}
          </button>
          <button
            type="button"
            className="settings-inline-link"
            disabled={controlsDisabled}
            onClick={() => void useAutomatic()}
          >
            <RotateCcw size={12} />
            Use automatic
          </button>
        </div>
      </div>

      {picking ? (
        loading ? (
          <div className="settings-icon-empty">
            <Loader2 size={16} className="spin" />
            Scanning repository…
          </div>
        ) : images && images.length > 0 ? (
          <div className="settings-icon-grid">
            {images.map((image) => (
              <button
                type="button"
                key={image.relativePath}
                className="settings-icon-choice"
                title={image.relativePath}
                disabled={controlsDisabled}
                onClick={() => void choose(image.relativePath)}
              >
                <img src={image.dataUrl} alt="" draggable={false} />
                <span>{image.relativePath}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="settings-icon-empty">
            <ImageOff size={16} />
            No images found in this repository.
          </div>
        )
      ) : null}

      {error ? <p className="settings-field-note error">{error}</p> : null}
    </div>
  );
}

function LinkedFoldersSection({
  open,
  repoPath,
  disabled,
  onUpdateFolder,
  onSourcesChange,
}: {
  open: boolean;
  repoPath: string;
  disabled?: boolean;
  onUpdateFolder: (prefix: string) => Promise<void>;
  /// Report each linked folder's known source URL up so the parent can hide those
  /// remotes from the Remote URL list — a subtree's backing remote belongs here.
  onSourcesChange: (urls: string[]) => void;
}) {
  const [folders, setFolders] = useState<LinkedFolder[] | null>(null);
  // prefix → has updates upstream. `true` behind, `false` in sync, absent = not
  // yet checked / couldn't tell (offline, unknown source). Filled by an on-demand
  // network check, kept apart from the instant folder list.
  const [updates, setUpdates] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Push is tracked apart from `busy` (pull) so only the clicked button spins.
  const [pushing, setPushing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // `adding` = new folder form; `sourceFor` = set-source form for an existing,
  // unknown-source folder (its prefix). At most one is active.
  const [adding, setAdding] = useState(false);
  const [sourceFor, setSourceFor] = useState<string | null>(null);
  const [draft, setDraft] = useState({ folder: "", url: "", branch: "main" });

  const formOpen = adding || sourceFor !== null;

  function closeForm() {
    setAdding(false);
    setSourceFor(null);
    setDraft({ folder: "", url: "", branch: "main" });
  }

  // Best-effort network check: which folders have moved on upstream. Failures
  // (offline, unknown source) leave dots neutral rather than erroring the section.
  async function checkUpdates() {
    setChecking(true);
    try {
      const statuses = await checkSubtreeUpdates(repoPath);
      const next: Record<string, boolean> = {};
      for (const status of statuses) {
        if (status.updatesAvailable !== null) next[status.prefix] = status.updatesAvailable;
      }
      setUpdates(next);
    } catch {
      // Leave the last known dots in place; awareness is a convenience, not a gate.
    } finally {
      setChecking(false);
    }
  }

  async function reload() {
    try {
      const list = await listLinkedFolders(repoPath);
      setFolders(list);
      onSourcesChange(list.filter((folder) => folder.knownSource).map((folder) => folder.url));
      void checkUpdates();
    } catch (err) {
      setError(String(err));
      setFolders([]);
      onSourcesChange([]);
    }
  }

  useEffect(() => {
    if (!open) {
      closeForm();
      setError(null);
      setFolders(null);
      setUpdates({});
      onSourcesChange([]);
      return;
    }
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, repoPath]);

  const controlsDisabled = disabled || busy !== null || pushing !== null;

  function beginSetSource(folder: LinkedFolder) {
    setAdding(false);
    setSourceFor(folder.prefix);
    setDraft({ folder: folder.prefix, url: folder.url, branch: folder.branch || "main" });
    setError(null);
  }

  async function submitForm() {
    const url = draft.url.trim();
    const branch = draft.branch.trim() || "main";
    if (!url) return;
    setBusy("__form__");
    setError(null);
    try {
      if (sourceFor !== null) {
        await setLinkedFolderSource(repoPath, sourceFor, url, branch);
      } else {
        const folder = draft.folder.trim();
        if (!folder) return;
        await addLinkedFolder(repoPath, folder, url, branch);
      }
      closeForm();
      await reload();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }

  async function update(prefix: string) {
    setBusy(prefix);
    setError(null);
    setNotice(null);
    try {
      await onUpdateFolder(prefix);
      await reload();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }

  async function push(prefix: string) {
    setPushing(prefix);
    setError(null);
    setNotice(null);
    try {
      const result = await pushLinkedFolder(repoPath, prefix);
      setNotice(result.message);
      await reload();
    } catch (err) {
      setError(String(err));
    } finally {
      setPushing(null);
    }
  }

  async function remove(folder: LinkedFolder) {
    if (
      !window.confirm(
        `Remove ${folder.prefix}? This deletes its files (staged for your next commit) and unlinks it.`,
      )
    ) {
      return;
    }
    setBusy(folder.prefix);
    setError(null);
    try {
      await removeLinkedFolder(repoPath, folder.prefix, true);
      await reload();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="settings-field">
      <div className="settings-field-head">
        {/* "Linked repos", not "linked folders". The Folders section directly
            below is git worktrees — other checkouts of *this* repository — and
            the timeline chip that counts them also says Folders. Two unrelated
            features wearing one noun, stacked, both with a folder icon and an
            Add button, is the single most confusing thing in this drawer. The
            distinction that matters is whose code it is: a linked repo is
            somebody else's repository living in a subfolder of yours. */}
        <label>Linked repos</label>
        <div className="settings-field-head-actions">
          {folders && folders.length > 0 ? (
            <button
              type="button"
              className="settings-inline-link"
              disabled={controlsDisabled || checking}
              title="Check each linked repo's source for new updates"
              onClick={() => void checkUpdates()}
            >
              {checking ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
              Check for updates
            </button>
          ) : null}
          <button
            type="button"
            className="settings-inline-link"
            disabled={controlsDisabled || formOpen}
            onClick={() => {
              setSourceFor(null);
              setDraft({ folder: "", url: "", branch: "main" });
              setAdding(true);
            }}
          >
            <Plus size={12} />
            Add linked repo
          </button>
        </div>
      </div>

      {formOpen ? (
        <div className="subtree-add-form">
          <input
            className="settings-input settings-input-compact"
            value={draft.folder}
            onChange={(event) => setDraft((d) => ({ ...d, folder: event.currentTarget.value }))}
            placeholder="folder, e.g. vendor/ui-kit"
            aria-label="Folder"
            autoFocus={sourceFor === null}
            disabled={sourceFor !== null}
            spellCheck={false}
          />
          <input
            className="settings-input"
            value={draft.url}
            onChange={(event) => setDraft((d) => ({ ...d, url: event.currentTarget.value }))}
            placeholder="git@github.com:acme/ui-kit.git"
            aria-label="Source URL"
            autoFocus={sourceFor !== null}
            spellCheck={false}
          />
          <div className="subtree-add-actions">
            <input
              className="settings-input settings-input-compact"
              value={draft.branch}
              onChange={(event) => setDraft((d) => ({ ...d, branch: event.currentTarget.value }))}
              placeholder="main"
              aria-label="Source branch"
              spellCheck={false}
            />
            <button
              type="button"
              className="ghost-btn"
              disabled={busy === "__form__"}
              onClick={closeForm}
            >
              Cancel
            </button>
            <button
              type="button"
              className="settings-btn primary"
              disabled={
                busy === "__form__" ||
                !draft.url.trim() ||
                (sourceFor === null && !draft.folder.trim())
              }
              onClick={() => void submitForm()}
            >
              {busy === "__form__" ? <Loader2 size={14} className="spin" /> : null}
              {sourceFor !== null ? "Save source" : "Add"}
            </button>
          </div>
        </div>
      ) : null}

      {folders === null ? (
        <div className="settings-icon-empty">
          <Loader2 size={16} className="spin" />
          Loading…
        </div>
      ) : folders.length === 0 ? (
        !formOpen ? (
          <p className="settings-field-note">
            Mirror another repository into a subfolder of this one. Its files are committed here as
            real files, so a fresh clone just works.
          </p>
        ) : null
      ) : (
        // The explanation used to live only in the empty state, which meant the
        // people most likely to need it — anyone who cloned a repo that already
        // had one, since the manifest is committed — never saw it at all.
        <div className="subtree-list">
          <p className="settings-field-note">
            Each of these is another repository mirrored into a subfolder of this one.
          </p>
          {folders.map((folder) => (
            <div className="subtree-item" key={folder.prefix}>
              <FolderGit2 size={16} className="subtree-item-icon" />
              <div className="subtree-item-body">
                <span className="subtree-item-name">{folder.prefix}</span>
                <span className="subtree-item-source">
                  {prettySource(folder.url)}
                  {folder.knownSource ? ` · ${folder.branch}` : ""}
                  {folder.dirty ? " · edited" : ""}
                </span>
              </div>
              {folder.knownSource ? (
                <>
                  {updates[folder.prefix] === true ? (
                    <span
                      className="subtree-status behind"
                      title="The source has moved on — Update to pull it in"
                    >
                      <span className="subtree-status-dot" />
                      Updates
                    </span>
                  ) : updates[folder.prefix] === false ? (
                    <span
                      className="subtree-status synced"
                      title="Up to date with the source"
                      aria-label="Up to date with the source"
                    >
                      <span className="subtree-status-dot" />
                    </span>
                  ) : checking ? (
                    <span className="subtree-status checking" title="Checking for updates…">
                      <Loader2 size={11} className="spin" />
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className={updates[folder.prefix] === true ? "settings-btn primary" : "settings-btn"}
                    title="Pull the latest from the source"
                    disabled={controlsDisabled}
                    onClick={() => void update(folder.prefix)}
                  >
                    {busy === folder.prefix ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <ArrowDownToLine size={14} />
                    )}
                    Update
                  </button>
                  <button
                    type="button"
                    className="settings-btn"
                    title="Publish this linked repo's committed changes back to its source"
                    disabled={controlsDisabled}
                    onClick={() => void push(folder.prefix)}
                  >
                    {pushing === folder.prefix ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <ArrowUpFromLine size={14} />
                    )}
                    Publish
                  </button>
                  <button
                    type="button"
                    className="icon-btn sm"
                    aria-label={`Edit source for ${folder.prefix}`}
                    title="Edit source URL & branch"
                    disabled={controlsDisabled}
                    onClick={() => beginSetSource(folder)}
                  >
                    <Pencil size={14} />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="settings-btn"
                  title="Gitty couldn't find this linked repo's source — set it to enable Update"
                  disabled={controlsDisabled}
                  onClick={() => beginSetSource(folder)}
                >
                  <Pencil size={14} />
                  Set source
                </button>
              )}
              <button
                type="button"
                className="icon-btn sm"
                aria-label={`Remove ${folder.prefix}`}
                disabled={controlsDisabled}
                onClick={() => void remove(folder)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {error ? <p className="settings-field-note error">{error}</p> : null}
      {notice && !error ? <p className="settings-field-note">{notice}</p> : null}
    </div>
  );
}

export function RepoSettingsDrawer({
  open,
  repoName,
  repoPath,
  remotes,
  onClose,
  onSaveRemote,
  onRemoveRemote,
  onFetch,
  onRemoveRepo,
  onUpdateFolder,
  onOpenWorktree,
  worktrees,
  onWorktreesChanged,
  onConfirmRemove,
  backupAvailable,
  backupOnPush,
  hasBackupRemote,
  onBackupOnPushChange,
  disabled,
}: RepoSettingsDrawerProps) {
  const [drafts, setDrafts] = useState<RemoteDraft[]>(() => remotesToDrafts(remotes));
  const [baseline, setBaseline] = useState<RemoteDraft[]>(() => remotesToDrafts(remotes));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingBackupPreference, setSavingBackupPreference] = useState(false);
  // Canonical URLs of linked-folder sources, reported by the section below. A
  // saved remote whose URL matches one is hidden here — it lives under Linked
  // folders instead of masquerading as a repo remote.
  const [subtreeUrls, setSubtreeUrls] = useState<Set<string>>(new Set());
  // What could be removed without losing anything, and why. Read here rather
  // than in the Folders panel because the hint at the top of this drawer needs
  // the same answer, and the panel is several screens further down.
  const [cleanup, setCleanup] = useState<WorktreeCleanupEntry[]>([]);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [hintDismissedFor, setHintDismissedFor] = useState<string | null>(null);
  const cleanupRequestRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const next = remotesToDrafts(remotes);
    setDrafts(next);
    setBaseline(next);
    setSaveError(null);
  }, [open, remotes]);

  // The scan walks every other folder's working tree, so it only runs while
  // this drawer is open. A late answer from a repository the user has already
  // switched away from is dropped rather than shown.
  //
  // Deliberately not keyed on `worktrees`: that array is rebuilt on every
  // window focus and after every removal, and re-scanning then rebuilt the
  // review list underneath whoever was reading it. Removals prune their own
  // rows, and a folder that has only just been added is never one you are
  // finished with, so there is nothing this would catch that matters.
  useEffect(() => {
    if (!open || !repoPath) {
      setCleanup([]);
      // Otherwise the review is still open the next time this drawer is, over
      // folders that were judged for a repository the user has left.
      setCleanupOpen(false);
      setCleanupError(null);
      return;
    }
    const request = cleanupRequestRef.current + 1;
    cleanupRequestRef.current = request;
    invoke<WorktreeCleanupEntry[]>("scan_worktree_cleanup", { path: repoPath })
      .then((result) => {
        if (cleanupRequestRef.current === request) setCleanup(result);
      })
      .catch(() => {
        if (cleanupRequestRef.current === request) setCleanup([]);
      });
  }, [open, repoPath]);

  const dirty = useMemo(() => draftsDirty(baseline, drafts), [baseline, drafts]);
  const canSave = dirty && validDrafts(drafts).length > 0 && !saving;
  const canFetch = uniqueRemotes(remotes).length > 0;

  const finishedFolders = cleanup.filter((entry) => entry.verdict === "safe");
  const hintKey = `gitty.folderCleanupHint:${repoPath}`;
  // Keyed on *which* folders are finished rather than a plain "seen it" flag:
  // dismissing the hint over two stale folders shouldn't silence it when a
  // third one finishes months later.
  const hintSignature = finishedFolders
    .map((entry) => entry.path)
    .sort()
    .join(" ");
  const showCleanupHint = finishedFolders.length > 0 && hintDismissedFor !== hintSignature;

  useEffect(() => {
    if (!open) return;
    setHintDismissedFor(localStorage.getItem(hintKey));
  }, [open, hintKey]);

  function dismissCleanupHint() {
    localStorage.setItem(hintKey, hintSignature);
    setHintDismissedFor(hintSignature);
  }

  // Hide saved remotes that only back a linked folder; always keep unsaved rows.
  const visibleDrafts = drafts.filter(
    (draft) => !draft.existed || !subtreeUrls.has(canonicalUrl(draft.url)),
  );

  function updateDraft(id: string, patch: Partial<Pick<RemoteDraft, "name" | "url">>) {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    );
    setSaveError(null);
  }

  function addDraft() {
    const taken = new Set(drafts.map((draft) => draft.name.trim()).filter(Boolean));
    let number = 1;
    let name = "backup";
    while (taken.has(name)) {
      number += 1;
      name = `backup-${number}`;
    }
    setDrafts((current) => [
      ...current,
      { id: `new-${Date.now()}`, name, url: "", existed: false },
    ]);
  }

  function removeDraft(id: string) {
    setDrafts((current) => {
      const draft = current.find((item) => item.id === id);
      if (!draft) return current;
      if (current.length === 1) {
        return [{ id: "new-origin", name: "origin", url: "", existed: false }];
      }
      return current.filter((item) => item.id !== id);
    });
  }

  async function saveDrafts() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);

    try {
      for (const draft of validDrafts(drafts)) {
        const previous = baseline.find((item) => item.id === draft.id);
        const name = draft.name.trim();
        const url = draft.url.trim();
        const unchanged = previous && previous.name.trim() === name && previous.url.trim() === url;
        if (unchanged) continue;

        const ok = await onSaveRemote(name, url);
        if (!ok) throw new Error(`Could not save remote "${name}".`);
      }
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function removeDraftNow(id: string) {
    const draft = drafts.find((item) => item.id === id);
    if (!draft) return;

    if (draft.existed) {
      if (!window.confirm(`Remove remote "${draft.name}"?`)) return;
      setSaving(true);
      setSaveError(null);
      const ok = await onRemoveRemote(draft.name);
      setSaving(false);
      if (!ok) {
        setSaveError(`Could not remove remote "${draft.name}".`);
        return;
      }
      removeDraft(id);
      setBaseline((current) => current.filter((item) => item.id !== id));
      return;
    }

    removeDraft(id);
  }

  async function removeFinishedFolders(paths: string[]) {
    setCleanupBusy(true);
    setCleanupError(null);
    try {
      const outcome = await invoke<WorktreeCleanupOutcome>("remove_worktrees", {
        path: repoPath,
        worktrees: paths,
      });
      // Drop what went instead of re-reading every folder. Each one is judged
      // on its own, so removing three teaches the scan nothing about the rest —
      // and a list that rebuilds itself under the user mid-review is the thing
      // that makes a review feel unsafe.
      const gone = new Set(outcome.removed);
      setCleanup((current) => current.filter((entry) => !gone.has(entry.path)));

      // A partial result stays on screen with the folders that resisted named,
      // rather than closing on a message that says "removed 2 of 3" and leaving
      // the user to work out which one.
      if (outcome.failures.length > 0) {
        setCleanupError(
          outcome.failures.map((failure) => `${failure.path}: ${failure.message}`).join("\n"),
        );
      } else {
        setCleanupOpen(false);
      }
      // The folder list behind this dialog still has to catch up; only the
      // cleanup verdicts are pruned in place.
      onWorktreesChanged();
    } catch (err) {
      setCleanupError(String(err));
    } finally {
      setCleanupBusy(false);
    }
  }

  async function changeBackupOnPush(enabled: boolean) {
    setSavingBackupPreference(true);
    try {
      const saved = await onBackupOnPushChange(enabled);
      if (!saved) setSaveError("Could not update the backup preference.");
    } finally {
      setSavingBackupPreference(false);
    }
  }

  return (
    <>
    <SettingsModal
      open={open}
      title="Repository"
      subtitle={repoName}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="settings-btn danger-text"
            disabled={disabled || saving}
            onClick={onRemoveRepo}
          >
            Remove from Gitty
          </button>
          <div className="settings-footer-actions">
            <button
              type="button"
              className="settings-btn"
              disabled={disabled || saving || !canFetch}
              onClick={onFetch}
            >
              <Download size={14} />
              Fetch
            </button>
            <button
              type="button"
              className="settings-btn primary"
              disabled={disabled || !canSave}
              onClick={() => void saveDrafts()}
            >
              {saving ? <Loader2 size={14} className="spin" /> : null}
              Save
            </button>
          </div>
        </>
      }
    >
      {/* Folders sit at the bottom of a long drawer, so the one thing worth
          acting on gets said before the scroll. */}
      {showCleanupHint ? (
        <div className="cleanup-hint">
          <Sparkles size={14} />
          <span className="cleanup-hint-copy">
            <strong>
              {finishedFolders.length === 1
                ? "One folder here looks finished."
                : `${finishedFolders.length} folders here look finished.`}
            </strong>
            <span>Everything in them is saved and exists somewhere else too.</span>
          </span>
          <button
            type="button"
            className="settings-btn"
            disabled={disabled}
            onClick={() => setCleanupOpen(true)}
          >
            Review
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Dismiss"
            title="Not now"
            onClick={dismissCleanupHint}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      <RepoIconSection open={open} repoName={repoName} repoPath={repoPath} disabled={disabled} />

      <div className="settings-field">
        <div className="settings-field-head">
          <label>Primary remote & backups</label>
          <button
            type="button"
            className="settings-inline-link"
            disabled={disabled || saving}
            onClick={addDraft}
          >
            <Plus size={12} />
            Add backup
          </button>
        </div>

        <div className="settings-remote-list">
          {visibleDrafts.map((draft) => {
            const showNameField = draft.existed || visibleDrafts.length > 1;
            return (
              <div className="settings-remote-item" key={draft.id}>
                <div className="settings-remote-item-head">
                  {showNameField ? (
                    <input
                      className="settings-input settings-input-compact"
                      value={draft.name}
                      onChange={(event) => updateDraft(draft.id, { name: event.currentTarget.value })}
                      placeholder="backup"
                      aria-label="Remote name"
                      disabled={disabled || saving || draft.existed}
                    />
                  ) : (
                    <span className="settings-remote-label">origin</span>
                  )}
                  <button
                    type="button"
                    className="icon-btn sm settings-remote-remove"
                    aria-label={`Remove ${draft.name || "remote"}`}
                    disabled={disabled || saving}
                    onClick={() => void removeDraftNow(draft.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <input
                  className="settings-input"
                  value={draft.url}
                  onChange={(event) => updateDraft(draft.id, { url: event.currentTarget.value })}
                  placeholder="git@github.com:user/repo.git"
                  aria-label="Remote URL"
                  disabled={disabled || saving}
                />
              </div>
            );
          })}
        </div>

        {saveError ? <p className="settings-field-note error">{saveError}</p> : null}
        {!dirty && canFetch ? (
          <p className="settings-field-note">
            <code>origin</code> (or the first remote) is the primary for fetches and branch tracking.
            Every other remote is available as a separate backup destination.
          </p>
        ) : null}
        {backupAvailable && hasBackupRemote ? (
          <label className="settings-row backup-on-push-row">
            <span className="settings-row-copy">
              <strong>Back up after push</strong>
              <span>Copy successful pushes to this repository’s backup remote(s)</span>
            </span>
            <input
              type="checkbox"
              className="settings-switch"
              checked={backupOnPush}
              onChange={(event) => void changeBackupOnPush(event.currentTarget.checked)}
              disabled={disabled || saving || savingBackupPreference}
            />
          </label>
        ) : null}
      </div>

      <LinkedFoldersSection
        open={open}
        repoPath={repoPath}
        disabled={disabled}
        onUpdateFolder={onUpdateFolder}
        onSourcesChange={(urls) => setSubtreeUrls(new Set(urls.map(canonicalUrl)))}
      />

      {open ? (
        <WorktreeSection
          repoPath={repoPath}
          disabled={disabled}
          worktrees={worktrees}
          cleanup={cleanup}
          onReviewCleanup={() => setCleanupOpen(true)}
          onWorktreesChanged={onWorktreesChanged}
          onOpenWorktree={onOpenWorktree}
          onConfirmRemove={onConfirmRemove}
        />
      ) : null}
    </SettingsModal>

    <WorktreeCleanupDialog
      open={open && cleanupOpen}
      entries={cleanup}
      busy={cleanupBusy}
      error={cleanupError}
      onCancel={() => {
        setCleanupOpen(false);
        setCleanupError(null);
      }}
      onConfirm={(paths) => void removeFinishedFolders(paths)}
    />
    </>
  );
}
