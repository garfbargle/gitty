import { useEffect, useId, useRef, useState } from "react";
import type { CommitEntry, TagEntry } from "../types";
import { formatRelativeTime } from "../lib/git";
import { TagBadge } from "./TagBadge";
import { SettingsModal } from "./SettingsModal";

const PREVIOUS_TAG_LIMIT = 6;

type TagCreateDialogProps = {
  open: boolean;
  commit: CommitEntry | null;
  recentTags?: TagEntry[];
  loading?: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
};

export function TagCreateDialog({
  open,
  commit,
  recentTags = [],
  loading = false,
  onConfirm,
  onCancel,
}: TagCreateDialogProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const previousTags = recentTags.slice(0, PREVIOUS_TAG_LIMIT);

  useEffect(() => {
    if (!open) return;
    setName("");
    setNow(Date.now());
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open, commit?.hash]);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed || loading) return;
    onConfirm(trimmed);
  }

  return (
    <SettingsModal
      open={open && !!commit}
      title="Create tag"
      subtitle={commit ? `${commit.shortHash} · ${commit.subject}` : undefined}
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
            disabled={loading || !name.trim()}
          >
            Create tag
          </button>
        </div>
      }
    >
      {previousTags.length > 0 ? (
        <section className="previous-tags">
          <span className="field-label">Previous tags</span>
          <ul className="previous-tags-list">
            {previousTags.map((tag) => (
              <li className="previous-tag-row" key={tag.name}>
                <TagBadge name={tag.name} unpushed={tag.unpushed} muted />
                <span className="previous-tag-meta">
                  {formatRelativeTime(tag.date, now)} · {tag.shortHash}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <label className="field-label" htmlFor={inputId}>
        Tag name
      </label>
      <input
        id={inputId}
        ref={inputRef}
        className="settings-input"
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={previousTags[0]?.name ?? "v1.0.0"}
        disabled={loading}
        autoComplete="off"
        spellCheck={false}
      />
    </SettingsModal>
  );
}
