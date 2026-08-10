import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FolderMinus, Loader2 } from "lucide-react";
import type { WorktreeCleanupEntry } from "../types";
import { formatRelativeTime, shortenPath } from "../lib/git";
import { SettingsModal } from "./SettingsModal";

type WorktreeCleanupDialogProps = {
  open: boolean;
  entries: WorktreeCleanupEntry[];
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (paths: string[]) => void;
};

/// Folders Gitty is confident about are ticked when the dialog opens; folders
/// it is only fairly confident about are listed and left unticked. The user
/// removes what they choose, never what Gitty chose.
const GROUPS = [
  {
    verdict: "safe" as const,
    title: "Nothing would be lost",
    blurb: "Everything in these folders is saved and exists somewhere else too.",
  },
  {
    verdict: "probably" as const,
    title: "Probably finished with",
    blurb:
      "No commits would be lost, but these aren't quite closed off. Have a look before ticking one.",
  },
  {
    verdict: "keep" as const,
    title: "Gitty won't remove these",
    blurb: "Something in each of these exists only there.",
  },
];

function lastUsed(entry: WorktreeCleanupEntry): string | null {
  if (entry.lastUsedAt === null) return null;
  return formatRelativeTime(new Date(entry.lastUsedAt).toISOString());
}

export function WorktreeCleanupDialog({
  open,
  entries,
  busy,
  error,
  onCancel,
  onConfirm,
}: WorktreeCleanupDialogProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // Seeded on opening, and deliberately not on every change to `entries`: the
  // scan behind this dialog re-runs whenever the window regains focus, and
  // re-seeding then would silently re-tick a folder the user had just
  // unticked. Ticks the user did not make are the one thing this dialog must
  // never produce.
  //
  // A tick is not carried across openings either — the set of folders can
  // differ between visits, and a leftover tick would be a removal nobody
  // looked at.
  useEffect(() => {
    if (!open) return;
    setSelected(
      entriesRef.current
        .filter((entry) => entry.verdict === "safe")
        .map((entry) => entry.path),
    );
  }, [open]);

  const removable = useMemo(
    () => new Set(entries.filter((entry) => entry.verdict !== "keep").map((entry) => entry.path)),
    [entries],
  );
  const chosen = selected.filter((path) => removable.has(path));

  function toggle(path: string) {
    setSelected((current) =>
      current.includes(path) ? current.filter((item) => item !== path) : [...current, path],
    );
  }

  return (
    <SettingsModal
      open={open}
      title="Folders you're finished with"
      onClose={onCancel}
      footer={
        <div className="confirm-dialog-actions">
          <button type="button" className="settings-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="action-btn danger confirm-dialog-primary"
            disabled={busy || chosen.length === 0}
            onClick={() => onConfirm(chosen)}
          >
            {busy ? <Loader2 size={13} className="spin" /> : <FolderMinus size={13} />}
            {chosen.length === 1 ? "Remove 1 folder" : `Remove ${chosen.length} folders`}
          </button>
        </div>
      }
    >
      <p className="confirm-dialog-lede">
        Gitty looked at each of this repository's other folders and worked out what would be lost
        if it went. Ticked folders are deleted from your disk. No branch is deleted, and no commit
        is lost.
      </p>

      {GROUPS.map((group) => {
        const rows = entries.filter((entry) => entry.verdict === group.verdict);
        if (rows.length === 0) return null;

        return (
          <div className="cleanup-group" key={group.verdict}>
            <div className="cleanup-group-head">
              <h4>{group.title}</h4>
              <p>{group.blurb}</p>
            </div>

            <ul className="cleanup-list">
              {rows.map((entry) => {
                const selectable = group.verdict !== "keep";
                const age = lastUsed(entry);
                return (
                  <li key={entry.path} className={`cleanup-item ${group.verdict}`}>
                    <label className="cleanup-item-main">
                      <input
                        type="checkbox"
                        checked={selectable && selected.includes(entry.path)}
                        disabled={!selectable || busy}
                        onChange={() => toggle(entry.path)}
                      />
                      <span className="cleanup-item-text">
                        <span className="cleanup-item-title">
                          {entry.branch ?? "a single commit"}
                          {entry.missing ? <em className="worktree-badge missing">missing</em> : null}
                          {age && !entry.missing ? (
                            <em className="cleanup-item-age">last used {age}</em>
                          ) : null}
                        </span>
                        <small title={entry.path}>{shortenPath(entry.path)}</small>
                        <span className="cleanup-item-reason">{entry.reason}</span>
                        {entry.warnings.map((warning) => (
                          <span className="cleanup-item-warning" key={warning}>
                            <AlertTriangle size={11} />
                            {warning}
                          </span>
                        ))}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {error ? <p className="settings-error">{error}</p> : null}
    </SettingsModal>
  );
}
