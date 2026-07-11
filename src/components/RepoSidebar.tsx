import {
  BookmarkMinus,
  BookmarkPlus,
  FolderGit2,
  PanelLeftClose,
  Plus,
  Radar,
  RefreshCw,
  Settings,
} from "lucide-react";
import { memo, useCallback, useEffect, useState } from "react";
import type { DiscoveredRepoEntry, RepoEntry } from "../types";
import { shortenPath } from "../lib/git";
import { revealInFinder } from "../lib/finder";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { RepoIcon } from "./RepoIcon";

type RepoSidebarProps = {
  repos: RepoEntry[];
  discoveredRepos: DiscoveredRepoEntry[];
  discovering: boolean;
  selectedPath: string;
  contentPath: string;
  onSelect: (path: string) => void;
  onSaveDiscovered: (path: string) => void;
  onRemoveRepo: (path: string) => void;
  onReorder: (orderedPaths: string[]) => void;
  onAddExisting: () => void;
  onOpenSettings: () => void;
  onOpenRepoSettings: (path: string) => void;
  onRescanDiscovery: () => void;
  onHide?: () => void;
};

export const RepoSidebar = memo(function RepoSidebar({
  repos,
  discoveredRepos,
  discovering,
  selectedPath,
  contentPath,
  onSelect,
  onSaveDiscovered,
  onRemoveRepo,
  onReorder,
  onAddExisting,
  onOpenSettings,
  onOpenRepoSettings,
  onRescanDiscovery,
  onHide,
}: RepoSidebarProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);
  const activePath = optimisticPath ?? selectedPath;
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  const handleDrop = useCallback(
    (targetPath: string) => {
      const sourcePath = dragPath;
      setDragPath(null);
      setDragOverPath(null);
      if (!sourcePath || sourcePath === targetPath) return;
      const order = repos.map((repo) => repo.path);
      const from = order.indexOf(sourcePath);
      if (from === -1) return;
      order.splice(from, 1);
      // Compute the target index after removal so the item lands exactly where
      // the "insert before" line is shown, regardless of drag direction.
      const to = order.indexOf(targetPath);
      if (to === -1) return;
      order.splice(to, 0, sourcePath);
      onReorder(order);
    },
    [dragPath, onReorder, repos],
  );

  useEffect(() => {
    if (optimisticPath !== null && optimisticPath === contentPath) {
      setOptimisticPath(null);
    }
  }, [contentPath, optimisticPath]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleSelect = useCallback(
    (path: string) => {
      if (path === selectedPath && path === contentPath) return;
      setOptimisticPath(path);
      onSelect(path);
    },
    [contentPath, onSelect, selectedPath],
  );

  function openRepoContextMenu(event: React.MouseEvent, path: string, isSaved: boolean) {
    event.preventDefault();
    const items: ContextMenuItem[] = [
      {
        label: "Open in Finder",
        onClick: () => void revealInFinder(path),
      },
    ];
    if (isSaved) {
      items.push({
        label: "Repository settings",
        onClick: () => onOpenRepoSettings(path),
      });
    }
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items,
    });
  }

  return (
    <aside className="repo-sidebar">
      <header className="sidebar-header">
        <span>Repositories</span>
        <div className="sidebar-header-actions">
          <button type="button" className="icon-btn sm" title="Add repository" onClick={onAddExisting}>
            <Plus size={16} />
          </button>
          {onHide ? (
            <button
              type="button"
              className="icon-btn sm"
              title="Hide repositories"
              aria-label="Hide repositories"
              onClick={onHide}
            >
              <PanelLeftClose size={16} />
            </button>
          ) : null}
        </div>
      </header>

      <div className="repo-list">
        {repos.map((repo) => (
          <div
            className={`repo-item saved ${repo.path === activePath ? "active" : ""}${
              dragPath === repo.path ? " dragging" : ""
            }${dragOverPath === repo.path && dragPath !== repo.path ? " drag-over" : ""}`}
            key={repo.id}
            title={repo.path}
            draggable
            onDragStart={(event) => {
              setDragPath(repo.path);
              event.dataTransfer.effectAllowed = "move";
              // WebKit requires drag data to be set for drop events to fire.
              event.dataTransfer.setData("text/plain", repo.path);
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              if (dragPath) setDragOverPath(repo.path);
            }}
            onDragOver={(event) => {
              if (dragPath) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              handleDrop(repo.path);
            }}
            onDragEnd={() => {
              setDragPath(null);
              setDragOverPath(null);
            }}
            onContextMenu={(event) => openRepoContextMenu(event, repo.path, true)}
          >
            <button
              className="repo-item-main"
              type="button"
              onClick={() => handleSelect(repo.path)}
            >
              <RepoIcon path={repo.path} name={repo.name} size={30} className="repo-icon" />
              <div className="repo-text">
                <span className="repo-name-row">
                  <span className="repo-name">{repo.name}</span>
                  {repo.hasUncommittedChanges ? (
                    <span
                      className="repo-dirty-dot"
                      title="Uncommitted changes"
                      aria-label="Uncommitted changes"
                    />
                  ) : null}
                </span>
                <small>{shortenPath(repo.path)}</small>
              </div>
            </button>
            <button
              className="repo-remove-btn"
              type="button"
              title="Remove from Gitty"
              aria-label={`Remove ${repo.name} from Gitty`}
              onClick={(event) => {
                event.stopPropagation();
                onRemoveRepo(repo.path);
              }}
            >
              <BookmarkMinus size={15} />
            </button>
          </div>
        ))}

        <div className="repo-discovered-section">
          <div className="repo-discovered-label">
            <Radar size={12} className={discovering ? "discovering-pulse" : ""} />
            <span>Discovered</span>
            {discovering ? <span className="discovering-dot" aria-hidden="true" /> : null}
            <button
              type="button"
              className="repo-discovered-rescan"
              title="Scan again"
              disabled={discovering}
              onClick={onRescanDiscovery}
            >
              <RefreshCw size={12} className={discovering ? "spin" : ""} />
            </button>
          </div>

          {discovering && discoveredRepos.length === 0 ? (
            <p className="repo-discovered-empty">Scanning nearby folders…</p>
          ) : null}

          {discoveredRepos.map((repo) => (
            <div
              className={`repo-item discovered ${repo.path === activePath ? "active" : ""}`}
              key={repo.id}
              title={repo.path}
              onContextMenu={(event) => openRepoContextMenu(event, repo.path, false)}
            >
              <button
                className="repo-item-main"
                type="button"
                onClick={() => handleSelect(repo.path)}
              >
                <FolderGit2 size={16} className="repo-icon" />
                <div className="repo-text">
                  <span className="repo-name">{repo.name}</span>
                  <small>{shortenPath(repo.path)}</small>
                </div>
              </button>
              <button
                className="repo-save-btn"
                type="button"
                title="Save repository"
                aria-label={`Save ${repo.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onSaveDiscovered(repo.path);
                }}
              >
                <BookmarkPlus size={15} />
              </button>
            </div>
          ))}

          {!discovering && discoveredRepos.length === 0 ? (
            <p className="repo-discovered-empty">
              No other git repos found in ~/Developer, ~/Projects, and similar folders.
            </p>
          ) : null}
        </div>
      </div>

      <footer className="sidebar-footer">
        <button type="button" className="add-repo-btn" onClick={onAddExisting}>
          <Plus size={15} />
          Add Repository
        </button>
        <button type="button" className="icon-btn sm" title="App settings" onClick={onOpenSettings}>
          <Settings size={16} />
        </button>
      </footer>

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
