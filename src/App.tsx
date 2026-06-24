import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Download,
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
import { BranchBar, RemotePanel } from "./components/BranchBar";
import { ChangesPanel } from "./components/ChangesPanel";
import { CommitGraph } from "./components/CommitGraph";
import { DiffViewer } from "./components/DiffViewer";
import type { ActionResult, CommitEntry, DiffFocus, FileChange, RepoEntry, RepoSnapshot } from "./types";
import "./App.css";

const emptyDiff =
  "Select a commit or changed file to inspect the patch.";

function App() {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [focus, setFocus] = useState<DiffFocus>(null);
  const [diff, setDiff] = useState(emptyDiff);
  const [manualPath, setManualPath] = useState("");
  const [remoteName, setRemoteName] = useState("origin");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedCommit = focus?.kind === "commit" ? focus.commit : null;
  const selectedFile = focus?.kind === "file" ? focus.file : null;

  const remoteRows = useMemo(() => snapshot?.remotes ?? [], [snapshot]);

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
    setCommitMessage("");
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

  async function checkoutBranch(branch: string) {
    if (!selectedPath || branch === snapshot?.branch) {
      return;
    }
    const result = await run(() =>
      invoke<ActionResult>("checkout_branch", { path: selectedPath, branch }),
    );
    if (result) {
      setMessage(result.message);
      await refreshRepo();
    }
  }

  async function mergeBranch() {
    if (!selectedPath || !mergeTarget) {
      return;
    }
    const result = await run(() =>
      invoke<ActionResult>("merge_branch", { path: selectedPath, branch: mergeTarget }),
    );
    if (result) {
      setMessage(result.message);
      setMergeTarget("");
      await refreshRepo();
    }
  }

  async function stageFiles(files: string[]) {
    const result = await run(() =>
      invoke<ActionResult>("stage_files", { path: selectedPath, files, stage: true }),
    );
    if (result) {
      await refreshRepo();
    }
  }

  async function unstageFiles(files: string[]) {
    const result = await run(() =>
      invoke<ActionResult>("stage_files", { path: selectedPath, files, stage: false }),
    );
    if (result) {
      await refreshRepo();
    }
  }

  async function stageAll() {
    const result = await run(() =>
      invoke<ActionResult>("stage_all", { path: selectedPath, stage: true }),
    );
    if (result) {
      await refreshRepo();
    }
  }

  async function unstageAll() {
    const result = await run(() =>
      invoke<ActionResult>("stage_all", { path: selectedPath, stage: false }),
    );
    if (result) {
      await refreshRepo();
    }
  }

  async function commit() {
    if (!commitMessage.trim()) {
      return;
    }
    const result = await run(() =>
      invoke<ActionResult>("commit_repo", { path: selectedPath, message: commitMessage.trim() }),
    );
    if (result) {
      setMessage(result.message);
      setCommitMessage("");
      await refreshRepo();
    }
  }

  async function fetchRepo() {
    const result = await run(() => invoke<ActionResult>("fetch_repo", { path: selectedPath }));
    if (result) {
      setMessage(result.message);
      await refreshRepo();
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

  async function removeRemote(name: string) {
    if (!window.confirm(`Remove remote "${name}"?`)) {
      return;
    }
    const result = await run(() =>
      invoke<ActionResult>("remove_remote", { path: selectedPath, name }),
    );
    if (result) {
      setMessage(result.message);
      await refreshRepo();
    }
  }

  return (
    <main className="app-shell">
      <aside className="repo-sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <GitBranch size={18} />
          </div>
          <div>
            <h1>Gitty</h1>
            <p>Your repositories</p>
          </div>
        </div>

        <button className="primary-button sidebar-add" type="button" onClick={chooseRepoFolder}>
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
              <span className="repo-name">{repo.name}</span>
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
                <button type="button" className="toolbar-button" title="Refresh" onClick={() => void refreshRepo()}>
                  <RefreshCw size={15} />
                </button>
                <button type="button" className="toolbar-button" title="Fetch all remotes" onClick={() => void fetchRepo()}>
                  <Download size={15} />
                  Fetch
                </button>
                <button type="button" className="toolbar-button" title="Push" onClick={() => void push(false)}>
                  <Send size={15} />
                  Push
                </button>
                <button type="button" className="toolbar-button" title="Force push with lease" onClick={() => void push(true)}>
                  <GitPullRequestArrow size={15} />
                  Force
                </button>
                <button
                  type="button"
                  className="toolbar-button"
                  title="Soft reset to selected commit"
                  disabled={!selectedCommit}
                  onClick={() => void reset("soft")}
                >
                  <RotateCcw size={15} />
                  Soft
                </button>
                <button
                  type="button"
                  className="toolbar-button danger"
                  title="Hard reset to selected commit"
                  disabled={!selectedCommit}
                  onClick={() => void reset("hard")}
                >
                  <HardDriveDownload size={15} />
                  Hard
                </button>
                <button
                  type="button"
                  className="toolbar-button ghost danger"
                  title="Remove repository from Gitty"
                  onClick={() => void removeSelectedRepo(snapshot.repo.path)}
                >
                  <Trash2 size={15} />
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

            <BranchBar
              branches={snapshot.branches ?? []}
              currentBranch={snapshot.branch}
              mergeTarget={mergeTarget}
              onMergeTargetChange={setMergeTarget}
              onCheckout={(branch) => void checkoutBranch(branch)}
              onMerge={() => void mergeBranch()}
              disabled={loading}
            />

            <RemotePanel
              remotes={remoteRows}
              remoteName={remoteName}
              remoteUrl={remoteUrl}
              onRemoteNameChange={setRemoteName}
              onRemoteUrlChange={setRemoteUrl}
              onSave={() => void saveRemote()}
              onRemove={(name) => void removeRemote(name)}
              disabled={loading}
            />

            <section className="content-grid">
              <div className="left-column">
                <ChangesPanel
                  changes={snapshot.changes}
                  selectedPath={selectedFile?.path}
                  commitMessage={commitMessage}
                  onCommitMessageChange={setCommitMessage}
                  onSelect={(file) => void inspectFile(file)}
                  onStage={(files) => void stageFiles(files)}
                  onUnstage={(files) => void unstageFiles(files)}
                  onStageAll={() => void stageAll()}
                  onUnstageAll={() => void unstageAll()}
                  onCommit={() => void commit()}
                  disabled={loading}
                />

                <div className="history-panel">
                  <div className="panel-heading">
                    <GitCommitHorizontal size={16} />
                    <span>History</span>
                  </div>
                  <CommitGraph
                    commits={snapshot.commits}
                    selectedHash={selectedCommit?.hash}
                    onSelect={(commit) => void inspectCommit(commit)}
                  />
                </div>
              </div>

              <div className="diff-panel">
                <div className="panel-heading split">
                  <span>{diffTitle(focus)}</span>
                  {loading ? <em className="loading-label">Running git…</em> : null}
                </div>
                <DiffViewer raw={diff} emptyMessage={emptyDiff} />
              </div>
            </section>
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">
              <GitBranch size={28} />
            </div>
            <h2>Add a repository to start</h2>
            <p>
              Gitty keeps a sidebar of your repos and loads history, branches, and diffs on demand.
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

function diffTitle(focus: DiffFocus) {
  if (!focus) {
    return "Diff";
  }
  if (focus.kind === "file") {
    return focus.file.path;
  }
  return `${focus.commit.shortHash} · ${focus.commit.subject}`;
}

export default App;
