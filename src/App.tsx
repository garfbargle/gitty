import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderPlus, GitBranch } from "lucide-react";
import { ActionsPanel } from "./components/ActionsPanel";
import { DiffViewer } from "./components/DiffViewer";
import { HistoryTable } from "./components/HistoryTable";
import { MainToolbar, SettingsDrawer } from "./components/MainToolbar";
import { RepoSidebar } from "./components/RepoSidebar";
import { StagingArea } from "./components/StagingArea";
import type {
  ActionResult,
  CommitEntry,
  DiffFocus,
  FileChange,
  RepoEntry,
  RepoSnapshot,
} from "./types";
import { parseRefs, primaryRef } from "./lib/git";
import "./App.css";

const emptyDiff = "Select a commit or changed file to view its diff.";

function App() {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [focus, setFocus] = useState<DiffFocus>(null);
  const [diff, setDiff] = useState(emptyDiff);
  const [commitSearch, setCommitSearch] = useState("");
  const [checkoutBranch, setCheckoutBranch] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [remoteName, setRemoteName] = useState("origin");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedCommit = focus?.kind === "commit" ? focus.commit : null;
  const selectedFile = focus?.kind === "file" ? focus.file : null;
  const showDiff = focus !== null;

  const primaryRemote = useMemo(() => {
    const names = snapshot?.remotes.map((remote) => remote.name) ?? [];
    return names.includes("origin") ? "origin" : names[0] ?? "origin";
  }, [snapshot]);

  useEffect(() => {
    void loadRepos();
  }, []);

  useEffect(() => {
    if (snapshot?.branch) {
      setCheckoutBranch(snapshot.branch);
    }
  }, [snapshot?.branch]);

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
    setAmend(false);
    setCommitSearch("");
    await refreshRepo(path);
  }

  async function refreshRepo(path = selectedPath) {
    if (!path) return;
    const result = await run(() =>
      invoke<RepoSnapshot>("repo_snapshot", { path, limit: 200 }),
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
      if (repo) await selectRepo(repo.path);
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

  async function initRepo() {
    const folder = await open({
      directory: true,
      multiple: false,
      title: "Choose folder for new repository",
    });
    if (typeof folder === "string") {
      const result = await run(() => invoke<RepoEntry[]>("init_repo", { path: folder }));
      if (result) {
        setRepos(result);
        const repo = result.find((item) => item.path === folder) ?? result[result.length - 1];
        if (repo) await selectRepo(repo.path);
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

  async function checkoutBranchAction(branch = checkoutBranch) {
    if (!selectedPath || !branch || branch === snapshot?.branch) return;
    const result = await run(() =>
      invoke<ActionResult>("checkout_branch", { path: selectedPath, branch }),
    );
    if (result) {
      setMessage(result.message);
      await refreshRepo();
    }
  }

  async function checkoutFromCommit(commit: CommitEntry) {
    const ref = primaryRef(commit.refs) || parseRefs(commit.refs)[0];
    if (ref && !ref.startsWith("tag:")) {
      await checkoutBranchAction(ref.replace(/^origin\//, "") || ref);
      return;
    }
    if (!window.confirm(`Check out detached commit ${commit.shortHash}?`)) return;
    const result = await run(() =>
      invoke<ActionResult>("checkout_branch", {
        path: selectedPath,
        branch: commit.hash,
      }),
    );
    if (result) {
      setMessage(result.message);
      await refreshRepo();
    }
  }

  async function mergeBranch() {
    if (!selectedPath || !mergeTarget) return;
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
    await run(() =>
      invoke<ActionResult>("stage_files", { path: selectedPath, files, stage: true }),
    );
    await refreshRepo();
  }

  async function unstageFiles(files: string[]) {
    await run(() =>
      invoke<ActionResult>("stage_files", { path: selectedPath, files, stage: false }),
    );
    await refreshRepo();
  }

  async function unstageAll() {
    await run(() => invoke<ActionResult>("stage_all", { path: selectedPath, stage: false }));
    await refreshRepo();
  }

  async function commit() {
    if (!commitMessage.trim()) return;
    const result = await run(() =>
      invoke<ActionResult>("commit_repo", {
        path: selectedPath,
        message: commitMessage.trim(),
        amend,
      }),
    );
    if (result) {
      setMessage(result.message);
      setCommitMessage("");
      setAmend(false);
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
    if (!selectedPath) return;
    if (force && !window.confirm("Force push with --force-with-lease?")) return;
    const result = await run(() =>
      invoke<ActionResult>("push_repo", { path: selectedPath, force }),
    );
    if (result) {
      setMessage([result.message, result.output].filter(Boolean).join("\n"));
      await refreshRepo();
    }
  }

  async function reset(mode: "soft" | "hard") {
    if (!selectedCommit || !selectedPath) return;
    if (mode === "hard" && !window.confirm(`Hard reset to ${selectedCommit.shortHash}?`)) {
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
    if (!window.confirm(`Remove remote "${name}"?`)) return;
    const result = await run(() =>
      invoke<ActionResult>("remove_remote", { path: selectedPath, name }),
    );
    if (result) {
      setMessage(result.message);
      await refreshRepo();
    }
  }

  async function removeSelectedRepo() {
    if (!snapshot) return;
    if (!window.confirm(`Remove ${snapshot.repo.name} from Gitty?`)) return;
    const result = await run(() =>
      invoke<RepoEntry[]>("remove_repo", { path: snapshot.repo.path }),
    );
    if (result) {
      setRepos(result);
      setSettingsOpen(false);
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

  return (
    <main className="app-shell">
      <RepoSidebar
        repos={repos}
        selectedPath={selectedPath}
        onSelect={(path) => void selectRepo(path)}
        onAddExisting={() => void chooseRepoFolder()}
        onInitRepo={() => void initRepo()}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <section className="main-center">
        {snapshot ? (
          <>
            <MainToolbar
              repoName={snapshot.repo.name}
              branch={snapshot.branch}
              search={commitSearch}
              loading={loading}
              onSearchChange={setCommitSearch}
              onRefresh={() => void refreshRepo()}
            />

            <div className="center-stack">
              <div className={`history-section ${showDiff ? "with-diff" : ""}`}>
                <HistoryTable
                  commits={snapshot.commits}
                  selectedHash={selectedCommit?.hash}
                  search={commitSearch}
                  onSelect={(commit) => void inspectCommit(commit)}
                  onDoubleClick={(commit) => void checkoutFromCommit(commit)}
                />

                {showDiff ? (
                  <div className="diff-drawer">
                    <header className="diff-drawer-header">
                      <span>{diffTitle(focus)}</span>
                      <button type="button" className="link-btn" onClick={() => { setFocus(null); setDiff(emptyDiff); }}>
                        Close
                      </button>
                    </header>
                    <DiffViewer raw={diff} emptyMessage={emptyDiff} />
                  </div>
                ) : null}
              </div>

              <StagingArea
                changes={snapshot.changes}
                selectedPath={selectedFile?.path}
                commitMessage={commitMessage}
                amend={amend}
                onCommitMessageChange={setCommitMessage}
                onAmendChange={setAmend}
                onSelect={(file) => void inspectFile(file)}
                onStage={(files) => void stageFiles(files)}
                onUnstage={(files) => void unstageFiles(files)}
                onUnstageAll={() => void unstageAll()}
                onCommit={() => void commit()}
                disabled={loading}
              />
            </div>
          </>
        ) : (
          <div className="empty-state">
            <GitBranch size={32} />
            <h2>Add a repository to start</h2>
            <p>Track all your repos in one window — browse history, stage changes, and push.</p>
            <button className="sidebar-btn primary" type="button" onClick={chooseRepoFolder}>
              <FolderPlus size={16} />
              Add Existing Repo
            </button>
          </div>
        )}

        {(message || error) && (
          <footer className={`toast ${error ? "error" : ""}`}>
            <pre>{error || message}</pre>
          </footer>
        )}
      </section>

      {snapshot ? (
        <ActionsPanel
          branches={snapshot.branches ?? []}
          currentBranch={snapshot.branch}
          upstream={snapshot.upstream}
          ahead={snapshot.ahead}
          behind={snapshot.behind}
          checkoutBranch={checkoutBranch}
          mergeTarget={mergeTarget}
          primaryRemote={primaryRemote}
          onCheckoutBranchChange={setCheckoutBranch}
          onMergeTargetChange={setMergeTarget}
          onCheckout={() => void checkoutBranchAction()}
          onMerge={() => void mergeBranch()}
          onResetSoft={() => void reset("soft")}
          onResetHard={() => void reset("hard")}
          onPush={() => void push(false)}
          onForcePush={() => void push(true)}
          hasSelectedCommit={!!selectedCommit}
          disabled={loading}
        />
      ) : null}

      {snapshot ? (
        <SettingsDrawer
          open={settingsOpen}
          remotes={snapshot.remotes}
          remoteName={remoteName}
          remoteUrl={remoteUrl}
          onClose={() => setSettingsOpen(false)}
          onRemoteNameChange={setRemoteName}
          onRemoteUrlChange={setRemoteUrl}
          onSaveRemote={() => void saveRemote()}
          onRemoveRemote={(name) => void removeRemote(name)}
          onFetch={() => void fetchRepo()}
          onRemoveRepo={() => void removeSelectedRepo()}
          disabled={loading}
        />
      ) : null}
    </main>
  );
}

function diffTitle(focus: DiffFocus) {
  if (!focus) return "Diff";
  if (focus.kind === "file") return focus.file.path;
  return `${focus.commit.shortHash} · ${focus.commit.subject}`;
}

export default App;
