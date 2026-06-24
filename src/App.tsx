import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  FolderPlus,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequestArrow,
  HardDriveDownload,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import "./App.css";

type RepoEntry = {
  id: string;
  name: string;
  path: string;
};

type CommitEntry = {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  date: string;
  refs: string;
  subject: string;
};

type FileChange = {
  status: string;
  path: string;
  oldPath?: string | null;
};

type RemoteEntry = {
  name: string;
  url: string;
  kind: string;
};

type RepoSnapshot = {
  repo: RepoEntry;
  branch: string;
  upstream?: string | null;
  ahead: number;
  behind: number;
  isClean: boolean;
  changes: FileChange[];
  commits: CommitEntry[];
  remotes: RemoteEntry[];
};

type ActionResult = {
  message: string;
  output: string;
};

type DiffFocus =
  | { kind: "commit"; commit: CommitEntry }
  | { kind: "file"; file: FileChange }
  | null;

const emptyDiff =
  "Select a commit or changed file to inspect the patch. Gitty runs Git only when you ask for data or perform an action.";

function App() {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [focus, setFocus] = useState<DiffFocus>(null);
  const [diff, setDiff] = useState(emptyDiff);
  const [manualPath, setManualPath] = useState("");
  const [remoteName, setRemoteName] = useState("origin");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedCommit = focus?.kind === "commit" ? focus.commit : null;
  const selectedFile = focus?.kind === "file" ? focus.file : null;

  const remoteRows = useMemo(() => {
    const rows = new Map<string, RemoteEntry>();
    snapshot?.remotes.forEach((remote) => {
      rows.set(`${remote.name}:${remote.kind}`, remote);
    });
    return Array.from(rows.values());
  }, [snapshot]);

  useEffect(() => {
    void loadRepos();
  }, []);

  async function run<T>(task: () => Promise<T>, successMessage = "") {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const result = await task();
      if (successMessage) {
        setMessage(successMessage);
      }
      return result;
    } catch (err) {
      setError(String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function loadRepos() {
    const result = await run(() => invoke<RepoEntry[]>("list_repos"));
    if (result) {
      setRepos(result);
      if (result.length > 0 && !selectedPath) {
        await selectRepo(result[0].path);
      }
    }
  }

  async function selectRepo(path: string) {
    setSelectedPath(path);
    setFocus(null);
    setDiff(emptyDiff);
    await refreshRepo(path);
  }

  async function refreshRepo(path = selectedPath) {
    if (!path) {
      return;
    }
    const result = await run(() =>
      invoke<RepoSnapshot>("repo_snapshot", { path, limit: 160 }),
    );
    if (result) {
      setSnapshot(result);
      setSelectedPath(result.repo.path);
    }
  }

  async function addRepo(path: string) {
    const result = await run(() => invoke<RepoEntry[]>("add_repo", { path }));
    if (result) {
      setRepos(result);
      const repo = result.find((item) => item.path === path) ?? result[result.length - 1];
      if (repo) {
        await selectRepo(repo.path);
      }
      setManualPath("");
    }
  }

  async function chooseRepoFolder() {
    const folder = await open({
      directory: true,
      multiple: false,
      title: "Choose a Git repository",
    });
    if (typeof folder === "string") {
      await addRepo(folder);
    }
  }

  async function removeSelectedRepo(path: string) {
    const result = await run(() => invoke<RepoEntry[]>("remove_repo", { path }));
    if (result) {
      setRepos(result);
      const next = result[0];
      if (next) {
        await selectRepo(next.path);
      } else {
        setSelectedPath("");
        setSnapshot(null);
        setFocus(null);
        setDiff(emptyDiff);
      }
    }
  }

  async function inspectCommit(commit: CommitEntry) {
    setFocus({ kind: "commit", commit });
    const result = await run(() =>
      invoke<string>("commit_diff", { path: selectedPath, commit: commit.hash }),
    );
    if (result !== null) {
      setDiff(result || "This commit has no patch output.");
    }
  }

  async function inspectFile(file: FileChange) {
    setFocus({ kind: "file", file });
    const result = await run(() =>
      invoke<string>("file_diff", { path: selectedPath, filePath: file.path }),
    );
    if (result !== null) {
      setDiff(result || "This file has no tracked diff.");
    }
  }

  async function push(force: boolean) {
    if (!selectedPath) {
      return;
    }
    if (force && !window.confirm("Force push with --force-with-lease?")) {
      return;
    }
    const result = await run(() =>
      invoke<ActionResult>("push_repo", { path: selectedPath, force }),
    );
    if (result) {
      setMessage([result.message, result.output].filter(Boolean).join("\n"));
      await refreshRepo();
    }
  }

  async function reset(mode: "soft" | "hard") {
    if (!selectedCommit || !selectedPath) {
      return;
    }
    const label = `${mode} reset to ${selectedCommit.shortHash}`;
    if (
      mode === "hard" &&
      !window.confirm(`${label}? This discards working tree changes.`)
    ) {
      return;
    }
    const result = await run(() =>
      invoke<ActionResult>("reset_to_commit", {
        path: selectedPath,
        commit: selectedCommit.hash,
        mode,
      }),
    );
    if (result) {
      setMessage([result.message, result.output].filter(Boolean).join("\n"));
      await refreshRepo();
    }
  }

  async function saveRemote() {
    if (!selectedPath) {
      return;
    }
    const result = await run(() =>
      invoke<ActionResult>("set_remote", {
        path: selectedPath,
        name: remoteName,
        url: remoteUrl,
      }),
    );
    if (result) {
      setMessage(result.message);
      setRemoteUrl("");
      await refreshRepo();
    }
  }

  return (
    <main className="app-shell">
      <aside className="repo-sidebar">
        <div className="brand-row">
          <GitBranch size={20} />
          <div>
            <h1>Gitty</h1>
            <p>Tracked repositories</p>
          </div>
        </div>

        <button className="primary-button" type="button" onClick={chooseRepoFolder}>
          <FolderPlus size={16} />
          Add repository
        </button>

        <form
          className="path-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (manualPath.trim()) {
              void addRepo(manualPath.trim());
            }
          }}
        >
          <input
            value={manualPath}
            onChange={(event) => setManualPath(event.currentTarget.value)}
            placeholder="/path/to/repository"
          />
        </form>

        <div className="repo-list">
          {repos.map((repo) => (
            <button
              className={`repo-item ${repo.path === selectedPath ? "active" : ""}`}
              key={repo.id}
              type="button"
              onClick={() => void selectRepo(repo.path)}
              title={repo.path}
            >
              <span>{repo.name}</span>
              <small>{repo.path}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="workspace">
        {snapshot ? (
          <>
            <header className="repo-header">
              <div className="repo-title">
                <span className="eyebrow">Repository</span>
                <h2>{snapshot.repo.name}</h2>
                <p>{snapshot.repo.path}</p>
              </div>

              <div className="toolbar" aria-label="Repository actions">
                <button type="button" title="Refresh" onClick={() => void refreshRepo()}>
                  <RefreshCw size={16} />
                </button>
                <button type="button" title="Push" onClick={() => void push(false)}>
                  <Send size={16} />
                  Push
                </button>
                <button type="button" title="Force push with lease" onClick={() => void push(true)}>
                  <GitPullRequestArrow size={16} />
                  Force
                </button>
                <button
                  type="button"
                  title="Soft reset to selected commit"
                  disabled={!selectedCommit}
                  onClick={() => void reset("soft")}
                >
                  <RotateCcw size={16} />
                  Soft
                </button>
                <button
                  type="button"
                  className="danger"
                  title="Hard reset to selected commit"
                  disabled={!selectedCommit}
                  onClick={() => void reset("hard")}
                >
                  <HardDriveDownload size={16} />
                  Hard
                </button>
                <button
                  type="button"
                  className="ghost danger"
                  title="Remove repository from Gitty"
                  onClick={() => void removeSelectedRepo(snapshot.repo.path)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </header>

            <div className="status-strip">
              <div>
                <span>Branch</span>
                <strong>{snapshot.branch}</strong>
              </div>
              <div>
                <span>Upstream</span>
                <strong>{snapshot.upstream || "none"}</strong>
              </div>
              <div>
                <span>Ahead / behind</span>
                <strong>
                  {snapshot.ahead} / {snapshot.behind}
                </strong>
              </div>
              <div>
                <span>Worktree</span>
                <strong>{snapshot.isClean ? "clean" : `${snapshot.changes.length} changed`}</strong>
              </div>
            </div>

            <section className="remote-panel">
              <div className="remote-list">
                {remoteRows.length === 0 ? (
                  <span>No remotes attached</span>
                ) : (
                  remoteRows.map((remote) => (
                    <span key={`${remote.name}-${remote.kind}-${remote.url}`}>
                      <strong>{remote.name}</strong> {remote.url} <em>{remote.kind}</em>
                    </span>
                  ))
                )}
              </div>
              <form
                className="remote-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveRemote();
                }}
              >
                <input
                  value={remoteName}
                  onChange={(event) => setRemoteName(event.currentTarget.value)}
                  aria-label="Remote name"
                  placeholder="origin"
                />
                <input
                  value={remoteUrl}
                  onChange={(event) => setRemoteUrl(event.currentTarget.value)}
                  aria-label="Remote URL"
                  placeholder="git@github.com:user/repo.git"
                />
                <button type="submit">Save remote</button>
              </form>
            </section>

            <section className="changes-row">
              {snapshot.changes.length === 0 ? (
                <span className="clean-state">No working tree changes</span>
              ) : (
                snapshot.changes.map((file) => (
                  <button
                    key={`${file.status}-${file.path}`}
                    className={selectedFile?.path === file.path ? "active" : ""}
                    type="button"
                    onClick={() => void inspectFile(file)}
                    title={file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}
                  >
                    <b>{file.status}</b>
                    <span>{file.path}</span>
                  </button>
                ))
              )}
            </section>

            <section className="main-grid">
              <div className="history-panel">
                <div className="panel-heading">
                  <GitCommitHorizontal size={16} />
                  <span>Commit history</span>
                </div>
                <div className="commit-list">
                  {snapshot.commits.map((commit) => (
                    <button
                      className={selectedCommit?.hash === commit.hash ? "commit active" : "commit"}
                      key={commit.hash}
                      type="button"
                      onClick={() => void inspectCommit(commit)}
                    >
                      <span className="commit-subject">{commit.subject}</span>
                      {commit.refs ? <span className="refs">{commit.refs}</span> : null}
                      <span className="commit-meta">
                        {commit.shortHash} · {commit.author} · {formatDate(commit.date)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="diff-panel">
                <div className="panel-heading split">
                  <span>{diffTitle(focus)}</span>
                  {loading ? <em>Running Git...</em> : null}
                </div>
                <pre>{diff}</pre>
              </div>
            </section>
          </>
        ) : (
          <div className="empty-state">
            <GitBranch size={34} />
            <h2>Add a repository to start</h2>
            <p>
              Gitty keeps a local catalog of paths, then reads history and diffs on demand.
            </p>
            <button className="primary-button" type="button" onClick={chooseRepoFolder}>
              <FolderPlus size={16} />
              Choose repository
            </button>
          </div>
        )}

        {(message || error) && (
          <footer className={`console ${error ? "error" : ""}`}>
            <pre>{error || message}</pre>
          </footer>
        )}
      </section>
    </main>
  );
}

function formatDate(date: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function diffTitle(focus: DiffFocus) {
  if (!focus) {
    return "Diff";
  }
  if (focus.kind === "file") {
    return focus.file.path;
  }
  return `${focus.commit.shortHash} ${focus.commit.subject}`;
}

export default App;
