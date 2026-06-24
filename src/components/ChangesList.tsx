import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ChangeSection, FileChange, SelectionAnchor } from "../types";
import { buildChangeEntries, moveChangeSelection, type ChangeEntry } from "../lib/changeEntries";
import { joinRepoPath, revealInFinder } from "../lib/finder";
import { isStaged, isUnstaged, statusCode } from "../lib/git";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { FilePathLabel } from "./FilePathLabel";

export type ChangesListHandle = {
  focus: () => void;
};

type ChangesListProps = {
  changes: FileChange[];
  repoPath?: string;
  selectedKey?: string;
  variant?: "working" | "commit";
  onSelect: (file: FileChange, section: ChangeSection) => void;
  onStage: (files: string[], anchor?: SelectionAnchor) => void;
  onUnstage: (files: string[], anchor?: SelectionAnchor) => void;
  onResetAll?: () => void;
  onFocusZone?: () => void;
  onExitToTimeline?: () => void;
  disabled?: boolean;
};

function statusClass(status: string) {
  const code = statusCode(status).toLowerCase();
  return code === "?" ? "untracked" : code;
}

export const ChangesList = forwardRef<ChangesListHandle, ChangesListProps>(function ChangesList(
  {
  changes,
  repoPath,
  selectedKey,
  variant = "working",
  onSelect,
  onStage,
  onUnstage,
  onResetAll,
  onFocusZone,
  onExitToTimeline,
  disabled,
  },
  ref,
) {
  const listRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const isCommitView = variant === "commit";
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  function openFileContextMenu(event: React.MouseEvent, filePath: string) {
    if (!repoPath) return;
    event.preventDefault();
    const absolutePath = joinRepoPath(repoPath, filePath);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          label: "Open in Finder",
          onClick: () => void revealInFinder(absolutePath),
        },
      ],
    });
  }

  const unstaged = changes.filter(isUnstaged);
  const staged = changes.filter(isStaged);
  const entries = useMemo(
    () => buildChangeEntries(changes, isCommitView ? "commit" : "working"),
    [changes, isCommitView],
  );

  useImperativeHandle(ref, () => ({
    focus: () => listRef.current?.focus(),
  }));

  const activeIndex = selectedKey ? entries.findIndex((entry) => entry.key === selectedKey) : -1;

  useEffect(() => {
    if (activeIndex < 0) return;
    const entry = entries[activeIndex];
    itemRefs.current.get(entry.key)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, entries]);

  function selectEntry(entry: ChangeEntry) {
    onFocusZone?.();
    onSelect(entry.file, entry.section);
    listRef.current?.focus();
  }

  function moveSelection(delta: number) {
    const next = moveChangeSelection(entries, activeIndex, delta);
    if (next) selectEntry(next);
  }

  function indexInSection(entry: ChangeEntry) {
    if (entry.section === "commit") {
      return changes.findIndex((file) => file.path === entry.file.path);
    }
    const list = entry.section === "unstaged" ? unstaged : staged;
    return list.findIndex((file) => file.path === entry.file.path);
  }

  function toggleStage(entry: ChangeEntry, anchor?: SelectionAnchor) {
    if (disabled || isCommitView) return;
    if (entry.section === "unstaged") {
      onStage([entry.file.path], anchor);
    } else {
      onUnstage([entry.file.path], anchor);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (isCommitView && activeIndex <= 0) {
        onExitToTimeline?.();
        listRef.current?.blur();
        return;
      }
      moveSelection(-1);
    } else if (!isCommitView && (event.key === " " || event.code === "Space")) {
      event.preventDefault();
      if (activeIndex < 0) return;
      const entry = entries[activeIndex];
      toggleStage(entry, { section: entry.section, index: indexInSection(entry) });
    }
  }

  function renderRow(entry: ChangeEntry) {
    const selected = entry.key === selectedKey;
    const isStagedRow = entry.section === "staged";

    return (
      <div
        className={`change-item ${selected ? "selected" : ""}${isCommitView ? " commit-only" : ""}`}
        key={entry.key}
        ref={(node) => {
          if (node) itemRefs.current.set(entry.key, node);
          else itemRefs.current.delete(entry.key);
        }}
        onContextMenu={(event) => openFileContextMenu(event, entry.file.path)}
      >
        {!isCommitView ? (
          <input
            type="checkbox"
            checked={isStagedRow}
            disabled={disabled}
            onChange={() =>
              toggleStage(entry, { section: entry.section, index: indexInSection(entry) })
            }
          />
        ) : null}
        <button
          type="button"
          className="change-path"
          onClick={() => selectEntry(entry)}
          title={entry.file.path}
        >
          <span className={`status-chip ${statusClass(entry.file.status)}`}>
            {statusCode(entry.file.status)}
          </span>
          <FilePathLabel path={entry.file.path} />
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
      aria-label={isCommitView ? "Commit files" : "Changed files"}
    >
      <header className="panel-title">
        <span>
          Changes
          <em>{changes.length}</em>
        </span>
        {!isCommitView && changes.length > 0 && onResetAll ? (
          <button
            type="button"
            className="badge reset-all"
            disabled={disabled}
            onClick={onResetAll}
            title="Discard all uncommitted changes"
          >
            Reset all
          </button>
        ) : null}
      </header>

      {isCommitView ? (
        <section className="change-group">
          <h4>Files ({changes.length})</h4>
          <div className="change-items">
            {changes.length === 0 ? (
              <p className="empty-hint">No files in this commit</p>
            ) : (
              entries.map(renderRow)
            )}
          </div>
        </section>
      ) : (
        <>
          <section className="change-group">
            <div className="change-group-header">
              <h4>Unstaged ({unstaged.length})</h4>
              {unstaged.length > 0 ? (
                <button
                  type="button"
                  className="badge stage-all"
                  disabled={disabled}
                  onClick={() => onStage(unstaged.map((file) => file.path))}
                  title="Stage all changes (⌘A)"
                >
                  Stage all
                  <kbd>⌘A</kbd>
                </button>
              ) : null}
            </div>
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
        </>
      )}

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={closeContextMenu}
        />
      ) : null}
    </aside>
  );
});
