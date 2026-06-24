import { useEffect, useMemo, useRef } from "react";
import type { ChangeSection, FileChange } from "../types";
import { isStaged, isUnstaged, statusCode } from "../lib/git";

type ChangeEntry = {
  file: FileChange;
  section: ChangeSection;
  key: string;
};

type ChangesListProps = {
  changes: FileChange[];
  selectedKey?: string;
  onSelect: (file: FileChange, section: ChangeSection) => void;
  onStage: (files: string[]) => void;
  onUnstage: (files: string[]) => void;
  disabled?: boolean;
};

function statusClass(status: string) {
  const code = statusCode(status).toLowerCase();
  return code === "?" ? "untracked" : code;
}

function buildEntries(changes: FileChange[]): ChangeEntry[] {
  const unstaged = changes.filter(isUnstaged);
  const staged = changes.filter(isStaged);
  return [
    ...unstaged.map((file) => ({
      file,
      section: "unstaged" as const,
      key: `unstaged:${file.path}`,
    })),
    ...staged.map((file) => ({
      file,
      section: "staged" as const,
      key: `staged:${file.path}`,
    })),
  ];
}

export function ChangesList({
  changes,
  selectedKey,
  onSelect,
  onStage,
  onUnstage,
  disabled,
}: ChangesListProps) {
  const listRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const unstaged = changes.filter(isUnstaged);
  const staged = changes.filter(isStaged);
  const entries = useMemo(() => buildEntries(changes), [changes]);

  const activeIndex = selectedKey ? entries.findIndex((entry) => entry.key === selectedKey) : -1;

  useEffect(() => {
    if (activeIndex < 0) return;
    const entry = entries[activeIndex];
    itemRefs.current.get(entry.key)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, entries]);

  function selectEntry(entry: ChangeEntry) {
    onSelect(entry.file, entry.section);
    listRef.current?.focus();
  }

  function moveSelection(delta: number) {
    if (entries.length === 0) return;
    const start = activeIndex >= 0 ? activeIndex : delta > 0 ? -1 : entries.length;
    const next = Math.max(0, Math.min(entries.length - 1, start + delta));
    selectEntry(entries[next]);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
    }
  }

  function renderRow(entry: ChangeEntry) {
    const selected = entry.key === selectedKey;
    const isStagedRow = entry.section === "staged";

    return (
      <div
        className={`change-item ${selected ? "selected" : ""}`}
        key={entry.key}
        ref={(node) => {
          if (node) itemRefs.current.set(entry.key, node);
          else itemRefs.current.delete(entry.key);
        }}
      >
        <input
          type="checkbox"
          checked={isStagedRow}
          disabled={disabled}
          onChange={() => (isStagedRow ? onUnstage([entry.file.path]) : onStage([entry.file.path]))}
        />
        <button
          type="button"
          className="change-path"
          onClick={() => selectEntry(entry)}
          title={entry.file.path}
        >
          <span className={`status-chip ${statusClass(entry.file.status)}`}>
            {statusCode(entry.file.status)}
          </span>
          <span>{entry.file.path}</span>
        </button>
      </div>
    );
  }

  return (
    <aside
      className="changes-list"
      ref={listRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Changed files"
    >
      <header className="panel-title">
        <span>Changes</span>
        <em>{changes.length}</em>
      </header>

      <section className="change-group">
        <h4>Unstaged ({unstaged.length})</h4>
        <div className="change-items">
          {unstaged.length === 0 ? (
            <p className="empty-hint">No unstaged files</p>
          ) : (
            entries.filter((entry) => entry.section === "unstaged").map(renderRow)
          )}
        </div>
      </section>

      <section className="change-group">
        <h4>Staged ({staged.length})</h4>
        <div className="change-items">
          {staged.length === 0 ? (
            <p className="empty-hint">Nothing staged</p>
          ) : (
            entries.filter((entry) => entry.section === "staged").map(renderRow)
          )}
        </div>
      </section>

      <div className="stage-dropzone">Drag files here to stage</div>
    </aside>
  );
}
