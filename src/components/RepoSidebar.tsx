import { BookmarkMinus, BookmarkPlus, FolderGit2, Plus, Radar, RefreshCw, Settings } from "lucide-react";
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
  onAddExisting: () => void;
  onOpenSettings: () => void;
  onOpenRepoSettings: (path: string) => void;
  onRescanDiscovery: () => void;
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
  onAddExisting,
  onOpenSettings,
  onOpenRepoSettings,
  onRescanDiscovery,
}: RepoSidebarProps) {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const [optimisticPath, setOptimisticPath] = useState<string | null>(null);
  const activePath = optimisticPath ?? selectedPath;

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
        <button type="button" className="icon-btn sm" title="Add repository" onClick={onAddExisting}>
          <Plus size={16} />
        </button>
      </header>

      <div className="repo-list">
        {repos.map((repo) => (
          <div
            className={`repo-item saved ${repo.path === activePath ? "active" : ""}`}
            key={repo.id}
            title={repo.path}
            onContextMenu={(event) => openRepoContextMenu(event, repo.path, true)}
          >
            <button
              className="repo-item-main"
              type="button"
              onClick={() => handleSelect(repo.path)}
            >
              <RepoIcon path={repo.path} name={repo.name} size={18} className="repo-icon" />
              <div className="repo-text">
                <span className="repo-name">{repo.name}</span>
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
