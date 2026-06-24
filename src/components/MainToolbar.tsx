import { FolderGit2, RefreshCw, Search } from "lucide-react";

type MainToolbarProps = {
  repoName: string;
  branch: string;
  search: string;
  loading?: boolean;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
};

export function MainToolbar({
  repoName,
  branch,
  search,
  loading,
  onSearchChange,
  onRefresh,
}: MainToolbarProps) {
  return (
    <header className="main-toolbar">
      <div className="toolbar-left">
        <FolderGit2 size={18} className="toolbar-repo-icon" />
        <h2>{repoName}</h2>
        <span className="branch-pill">{branch}</span>
      </div>
      <div className="toolbar-search">
        <Search size={15} />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.currentTarget.value)}
          placeholder="Search commits"
        />
      </div>
      <button
        type="button"
        className="icon-btn"
        title="Refresh"
        disabled={loading}
        onClick={onRefresh}
      >
        <RefreshCw size={16} className={loading ? "spin" : ""} />
      </button>
    </header>
  );
}
