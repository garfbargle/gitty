import { FolderGit2, FolderPlus, Plus, Settings } from "lucide-react";
import type { RepoEntry } from "../types";
import { shortenPath } from "../lib/git";

type RepoSidebarProps = {
  repos: RepoEntry[];
  selectedPath: string;
  onSelect: (path: string) => void;
  onAddExisting: () => void;
  onInitRepo: () => void;
  onOpenSettings: () => void;
};

export function RepoSidebar({
  repos,
  selectedPath,
  onSelect,
  onAddExisting,
  onInitRepo,
  onOpenSettings,
}: RepoSidebarProps) {
  return (
    <aside className="repo-sidebar">
      <div className="sidebar-actions">
        <button type="button" className="sidebar-btn" onClick={onInitRepo}>
          <Plus size={15} />
          Init Repo
        </button>
        <button type="button" className="sidebar-btn primary" onClick={onAddExisting}>
          <FolderPlus size={15} />
          Add Existing Repo
        </button>
      </div>

      <div className="sidebar-section-label">Repositories</div>

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

      <button type="button" className="settings-btn" onClick={onOpenSettings}>
        <Settings size={16} />
        Settings
      </button>
    </aside>
  );
}
