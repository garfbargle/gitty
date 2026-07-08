import { useEffect, useMemo, useState } from "react";
import { Download, ImageOff, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { RemoteEntry } from "../types";
import { SettingsModal } from "./SettingsModal";
import { RepoIcon } from "./RepoIcon";
import { clearRepoIcon, listRepoImages, setRepoIcon, type RepoImage } from "../lib/repoIcons";

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
  disabled?: boolean;
};

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
  disabled,
}: RepoSettingsDrawerProps) {
  const [drafts, setDrafts] = useState<RemoteDraft[]>(() => remotesToDrafts(remotes));
  const [baseline, setBaseline] = useState<RemoteDraft[]>(() => remotesToDrafts(remotes));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const next = remotesToDrafts(remotes);
    setDrafts(next);
    setBaseline(next);
    setSaveError(null);
  }, [open, remotes]);

  const dirty = useMemo(() => draftsDirty(baseline, drafts), [baseline, drafts]);
  const canSave = dirty && validDrafts(drafts).length > 0 && !saving;
  const canFetch = uniqueRemotes(remotes).length > 0;

  function updateDraft(id: string, patch: Partial<Pick<RemoteDraft, "name" | "url">>) {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    );
    setSaveError(null);
  }

  function addDraft() {
    setDrafts((current) => [
      ...current,
      { id: `new-${Date.now()}`, name: "", url: "", existed: false },
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

  return (
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
      <RepoIconSection open={open} repoName={repoName} repoPath={repoPath} disabled={disabled} />

      <div className="settings-field">
        <div className="settings-field-head">
          <label>Remote URL</label>
          <button
            type="button"
            className="settings-inline-link"
            disabled={disabled || saving}
            onClick={addDraft}
          >
            <Plus size={12} />
            Add remote
          </button>
        </div>

        <div className="settings-remote-list">
          {drafts.map((draft) => {
            const showNameField = draft.existed || drafts.length > 1;
            return (
              <div className="settings-remote-item" key={draft.id}>
                <div className="settings-remote-item-head">
                  {showNameField ? (
                    <input
                      className="settings-input settings-input-compact"
                      value={draft.name}
                      onChange={(event) => updateDraft(draft.id, { name: event.currentTarget.value })}
                      placeholder="origin"
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
          <p className="settings-field-note">Changes are saved to this repo&apos;s git config.</p>
        ) : null}
      </div>
    </SettingsModal>
  );
}
