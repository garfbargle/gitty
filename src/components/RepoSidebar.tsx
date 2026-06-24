import { FolderGit2, Plus, Settings } from "lucide-react";
import type { RepoEntry } from "../types";
import { shortenPath } from "../lib/git";

type RepoSidebarProps = {
  repos: RepoEntry[];
  selectedPath: string;
  onSelect: (path: string) => void;
  onAddExisting: () => void;
  onOpenSettings: () => void;
};

export function RepoSidebar({
  repos,
  selectedPath,
  onSelect,
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
