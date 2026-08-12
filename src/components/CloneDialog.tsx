import { useEffect, useId, useRef, useState } from "react";
import { CloudDownload } from "lucide-react";
import { SettingsModal } from "./SettingsModal";
import { SHORTCUT } from "../lib/shortcuts";

type CloneDialogProps = {
  open: boolean;
  /// Where the copy will land. Shown because on mobile the repository lives
  /// inside the app rather than in a folder the user picked, and that is
  /// surprising unless you say so.
  storeRoot: string;
  loading?: boolean;
  onConfirm: (url: string) => void;
  onCancel: () => void;
};

/// Folder name preview. Mirrors `clone_dir_name` in the backend, which is the
/// one that actually decides.
function folderNameFor(url: string): string | null {
  const trimmed = url.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  if (!trimmed) return null;
  const name = trimmed.split(/[/:]/).pop()?.trim() ?? "";
  if (!name || name === "." || name === "..") return null;
  return name;
}

export function CloneDialog({
  open,
  storeRoot,
  loading = false,
  onConfirm,
  onCancel,
}: CloneDialogProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const folder = folderNameFor(url);

  useEffect(() => {
    if (!open) return;
    setUrl("");
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  function submit() {
    const trimmed = url.trim();
    if (!trimmed || loading) return;
    onConfirm(trimmed);
  }

  return (
    <SettingsModal
      open={open}
      title="Add a repository"
      subtitle="Paste the address of a repository to copy it onto this device"
      onClose={onCancel}
      footer={
        <div className="settings-footer-actions">
          <button type="button" className="ghost-btn" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className="commit-primary"
            onClick={submit}
            disabled={loading || !url.trim()}
          >
            <CloudDownload size={14} />
            {loading ? "Copying…" : "Add repository"}
            <kbd>{SHORTCUT.confirm}</kbd>
          </button>
        </div>
      }
    >
      <label className="field-label" htmlFor={inputId}>
        Repository address
      </label>
      <input
        id={inputId}
        ref={inputRef}
        className="settings-input"
        value={url}
        onChange={(event) => setUrl(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="https://github.com/you/your-project.git"
        disabled={loading}
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="off"
      />
      <p className="settings-hint">
        {folder ? (
          <>
            Saved as <strong>{folder}</strong> in {storeRoot}
          </>
        ) : (
          <>Saved in {storeRoot}</>
        )}
      </p>
    </SettingsModal>
  );
}
