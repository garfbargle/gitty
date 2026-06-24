import { BookmarkPlus, FolderGit2, Plus, Radar, Settings } from "lucide-react";
import type { DiscoveredRepoEntry, RepoEntry } from "../types";
import { shortenPath } from "../lib/git";

type RepoSidebarProps = {
  repos: RepoEntry[];
  discoveredRepos: DiscoveredRepoEntry[];
  discovering: boolean;
  selectedPath: string;
  onSelect: (path: string) => void;
  onSaveDiscovered: (path: string) => void;
  onAddExisting: () => void;
  onOpenSettings: () => void;
};

export function RepoSidebar({
  repos,
  discoveredRepos,
  discovering,
  selectedPath,
  onSelect,
  onSaveDiscovered,
  onAddExisting,
  onOpenSettings,
}: RepoSidebarProps) {
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
          <button
            className={`repo-item ${repo.path === selectedPath ? "active" : ""}`}
            key={repo.id}
            type="button"
            onClick={() => onSelect(repo.path)}
            title={repo.path}
          >
            <FolderGit2 size={16} className="repo-icon" />
            <div className="repo-text">
              <span className="repo-name">{repo.name}</span>
              <small>{shortenPath(repo.path)}</small>
            </div>
          </button>
        ))}

        {discoveredRepos.length > 0 || discovering ? (
          <div className="repo-discovered-section">
            <div className="repo-discovered-label">
              <Radar size={12} className={discovering ? "discovering-pulse" : ""} />
              <span>Discovered</span>
              {discovering ? <span className="discovering-dot" aria-hidden="true" /> : null}
            </div>

            {discoveredRepos.map((repo) => (
              <div
                className={`repo-item discovered ${repo.path === selectedPath ? "active" : ""}`}
                key={repo.id}
                title={repo.path}
              >
                <button
                  className="repo-item-main"
                  type="button"
                  onClick={() => onSelect(repo.path)}
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
          </div>
        ) : null}
      </div>

      <footer className="sidebar-footer">
        <button type="button" className="add-repo-btn" onClick={onAddExisting}>
          <Plus size={15} />
          Add Repository
        </button>
        <button type="button" className="icon-btn sm" title="Settings" onClick={onOpenSettings}>
          <Settings size={16} />
        </button>
      </footer>
    </aside>
  );
}
