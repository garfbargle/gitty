import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderPlus, GitBranch } from "lucide-react";
import { ChangesList } from "./components/ChangesList";
import { CommitPanel } from "./components/CommitPanel";
import { DiffViewer } from "./components/DiffViewer";
import { HistoryTable } from "./components/HistoryTable";
import { HistoryTimeline } from "./components/HistoryTimeline";
import { SettingsDrawer } from "./components/MainToolbar";
import { RepoSidebar } from "./components/RepoSidebar";
import { TopBar } from "./components/TopBar";
import type {
  ActionResult,
  ChangeSection,
  CommitEntry,
  DiffFocus,
  DiscoveredRepoEntry,
  FileChange,
  RepoEntry,
  RepoSnapshot,
  SelectionAnchor,
} from "./types";
import { isStaged, isUnstaged, parseRefs, primaryRef } from "./lib/git";
import "./App.css";

const emptyDiff = "Select a file or commit to view its diff.";
const MAX_DISCOVERED = 48;

type ViewMode = "working" | "history";

function App() {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [discoveredRepos, setDiscoveredRepos] = useState<DiscoveredRepoEntry[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [selectedPath, setSelectedPath] = useState("");
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("working");
  const [focus, setFocus] = useState<DiffFocus>(null);
  const [diff, setDiff] = useState(emptyDiff);
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [amend, setAmend] = useState(false);
  const [resetMode, setResetMode] = useState<"soft" | "hard">("soft");
  const [remoteName, setRemoteName] = useState("origin");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedCommit = focus?.kind === "commit" ? focus.commit : null;
  const selectedFile = focus?.kind === "file" ? focus.file : null;
  const selectedFileKey =
    focus?.kind === "file" ? `${focus.section}:${focus.file.path}` : undefined;

  const branchNames = useMemo(() => {
    const branches = snapshot?.branches ?? [];
    const local = branches.filter((b) => !b.isRemote).map((b) => b.name);
    const remote = branches.filter((b) => b.isRemote).map((b) => b.name);
    return [...local, ...remote];
  }, [snapshot]);

  const savedPaths = useMemo(() => repos.map((repo) => repo.path), [repos]);
  const discoveryStarted = useRef(false);

  const startDiscovery = useCallback((paths: string[]) => {
    void invoke("start_repo_discovery", { savedPaths: paths }).catch(() => {
      setDiscovering(false);
    });
  }, []);

  useEffect(() => {
    void loadRepos();
  }, []);

  useEffect(() => {
    let active = true;
    const unlistenFound = listen<DiscoveredRepoEntry>("repo-discovery-found", (event) => {
      if (!active) return;
      const repo = event.payload;
      setDiscoveredRepos((current) => {
        const next = [repo, ...current.filter((item) => item.path !== repo.path)];
        return next.slice(0, MAX_DISCOVERED);
      });
    });
    const unlistenStarted = listen("repo-discovery-started", () => {
      if (active) setDiscovering(true);
    });
    const unlistenFinished = listen("repo-discovery-finished", () => {
      if (active) setDiscovering(false);
    });

    return () => {
      active = false;
      void unlistenFound.then((unlisten) => unlisten());
      void unlistenStarted.then((unlisten) => unlisten());
      void unlistenFinished.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    if (!reposLoaded || discoveryStarted.current) return;
    discoveryStarted.current = true;
    startDiscovery(savedPaths);
  }, [reposLoaded, savedPaths, startDiscovery]);

  useEffect(() => {
    setDiscoveredRepos((current) =>
      current.filter((repo) => !savedPaths.includes(repo.path)),
    );
  }, [savedPaths]);

  useEffect(() => {
    if (!snapshot || viewMode !== "working") return;
    const first = snapshot.changes.find(isUnstaged) ?? snapshot.changes.find(isStaged);
    if (first) {
      const section: ChangeSection = isUnstaged(first) ? "unstaged" : "staged";
      void inspectFile(first, section, snapshot.repo.path);
    }
  }, [snapshot?.repo.path]);

  async function run<T>(task: () => Promise<T>, successMessage = "") {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const result = await task();
      if (successMessage) setMessage(successMessage);
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
    setReposLoaded(true);
  }

  async function selectRepo(path: string) {
    setSelectedPath(path);
    setFocus(null);
    setDiff(emptyDiff);
    setSummary("");
    setDescription("");
    setAmend(false);
    setViewMode("working");
    await refreshRepo(path);
  }

  async function refreshRepo(path = selectedPath): Promise<RepoSnapshot | null> {
    if (!path) return null;
    const result = await run(() =>
      invoke<RepoSnapshot>("repo_snapshot", { path, limit: 200 }),
    );
    if (result) {
      setSnapshot(result);
      setSelectedPath(result.repo.path);
      return result;
    }
    return null;
  }

  async function selectAfterToggle(anchor: SelectionAnchor) {
    const snap = await refreshRepo();
    if (!snap) return;

    const list =
      anchor.section === "unstaged"
        ? snap.changes.filter(isUnstaged)
        : snap.changes.filter(isStaged);

    if (list.length === 0) {
      setFocus(null);
      setDiff(emptyDiff);
      return;
    }

    const index = Math.min(anchor.index, list.length - 1);
    await inspectFile(list[index], anchor.section);
  }

  async function addRepo(path: string) {
    const result = await run(() => invoke<RepoEntry[]>("add_repo", { path }));
    if (result) {
      setRepos(result);
      setDiscoveredRepos((current) => current.filter((repo) => repo.path !== path));
      const repo = result.find((item) => item.path === path) ?? result[result.length - 1];
      if (repo) await selectRepo(repo.path);
    }
  }

  async function saveDiscoveredRepo(path: string) {
    await addRepo(path);
  }

  async function chooseRepoFolder() {
    const folder = await open({
      directory: true,
      multiple: false,
      title: "Choose a Git repository",
    });
    if (typeof folder === "string") await addRepo(folder);
  }

  async function inspectCommit(commit: CommitEntry, path = selectedPath) {
    setFocus({ kind: "commit", commit });
    const result = await run(() =>
      invoke<string>("commit_diff", { path, commit: commit.hash }),
    );
    if (result !== null) setDiff(result || "This commit has no patch output.");
  }

  async function inspectFile(file: FileChange, section: ChangeSection, path = selectedPath) {
    setFocus({ kind: "file", file, section });
    const result = await run(() =>
      invoke<string>("file_diff", { path, filePath: file.path }),
    );
    if (result !== null) setDiff(result || "This file has no tracked diff.");
  }

  async function checkoutBranch(branch: string) {
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
      await checkoutBranch(ref.replace(/^origin\//, "") || ref);
      return;
    }
    if (!window.confirm(`Check out detached commit ${commit.shortHash}?`)) return;
    const result = await run(() =>
      invoke<ActionResult>("checkout_branch", { path: selectedPath, branch: commit.hash }),
    );
    if (result) {
      setMessage(result.message);
      await refreshRepo();
    }
  }

  async function stageFiles(files: string[], anchor?: SelectionAnchor) {
    const result = await run(() =>
      invoke<ActionResult>("stage_files", { path: selectedPath, files, stage: true }),
    );
    if (!result) return;
    if (anchor) await selectAfterToggle(anchor);
    else await refreshRepo();
  }

  async function unstageFiles(files: string[], anchor?: SelectionAnchor) {
    const result = await run(() =>
      invoke<ActionResult>("stage_files", { path: selectedPath, files, stage: false }),
    );
    if (!result) return;
    if (anchor) await selectAfterToggle(anchor);
    else await refreshRepo();
  }

  async function commit() {
    if (!summary.trim()) return;
    const message = description.trim()
      ? `${summary.trim()}\n\n${description.trim()}`
      : summary.trim();
    const result = await run(() =>
      invoke<ActionResult>("commit_repo", { path: selectedPath, message, amend }),
    );
    if (result) {
      setMessage(result.message);
      setSummary("");
      setDescription("");
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

  async function reset() {
    if (!selectedCommit || !selectedPath) return;
    if (resetMode === "hard" && !window.confirm(`Hard reset to ${selectedCommit.shortHash}?`)) {
      return;
    }
    const result = await run(() =>
      invoke<ActionResult>("reset_to_commit", {
        path: selectedPath,
        commit: selectedCommit.hash,
        mode: resetMode,
      }),
    );
    if (result) {
      setMessage([result.message, result.output].filter(Boolean).join("\n"));
      await refreshRepo();
    }
  }

  async function saveRemote() {
    const result = await run(() =>
      invoke<ActionResult>("set_remote", { path: selectedPath, name: remoteName, url: remoteUrl }),
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
      if (next) await selectRepo(next.path);
      else {
        setSelectedPath("");
        setSnapshot(null);
        setFocus(null);
        setDiff(emptyDiff);
      }
    }
  }

  const stagedCount = snapshot?.changes.filter(isStaged).length ?? 0;
  const unstagedCount = snapshot?.changes.filter(isUnstaged).length ?? 0;

  return (
    <main className="app-shell">
      <RepoSidebar
        repos={repos}
        discoveredRepos={discoveredRepos}
        discovering={discovering}
        selectedPath={selectedPath}
        onSelect={(path) => void selectRepo(path)}
        onSaveDiscovered={(path) => void saveDiscoveredRepo(path)}
        onAddExisting={() => void chooseRepoFolder()}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <section className="main-area">
        {snapshot ? (
          <>
            <TopBar
              repos={repos}
              selectedPath={selectedPath}
              branch={snapshot.branch}
              branches={branchNames.length > 0 ? branchNames : [snapshot.branch]}
              changeCount={snapshot.changes.length}
              viewMode={viewMode}
              loading={loading}
              onRepoChange={(path) => void selectRepo(path)}
              onBranchChange={(branch) => void checkoutBranch(branch)}
              onToggleView={() => {
                setViewMode((mode) => (mode === "working" ? "history" : "working"));
                if (viewMode === "history") {
                  setFocus(null);
                  setDiff(emptyDiff);
                }
              }}
              onRefresh={() => void refreshRepo()}
              onPush={() => void push(false)}
              onForcePush={() => void push(true)}
            />

            {viewMode === "working" ? (
              <>
                <HistoryTimeline
                  commits={snapshot.commits}
                  changeCount={snapshot.changes.length}
                  selectedHash={selectedCommit?.hash}
                  workingTreeActive={focus?.kind === "file" || (!selectedCommit && !!selectedFile)}
                  onSelect={(commit) => void inspectCommit(commit)}
                  onSelectWorkingTree={() => {
                    setViewMode("working");
                    const first = snapshot.changes.find(isUnstaged) ?? snapshot.changes.find(isStaged);
                    if (first) {
                      const section: ChangeSection = isUnstaged(first) ? "unstaged" : "staged";
                      void inspectFile(first, section);
                    }
                  }}
                />

                <div className="workspace-grid">
                  <ChangesList
                    changes={snapshot.changes}
                    selectedKey={selectedFileKey}
                    onSelect={(file, section) => void inspectFile(file, section)}
                    onStage={(files, anchor) => void stageFiles(files, anchor)}
                    onUnstage={(files, anchor) => void unstageFiles(files, anchor)}
                    disabled={loading}
                  />

                  <DiffViewer
                    raw={diff}
                    file={selectedFile}
                    emptyMessage={emptyDiff}
                    onUnstage={(path) => void unstageFiles([path])}
                  />

                  <CommitPanel
                    summary={summary}
                    description={description}
                    branch={snapshot.branch}
                    branches={snapshot.branches ?? []}
                    amend={amend}
                    resetMode={resetMode}
                    selectedCommit={selectedCommit}
                    stagedCount={stagedCount}
                    unstagedCount={unstagedCount}
                    onSummaryChange={setSummary}
                    onDescriptionChange={setDescription}
                    onAmendChange={setAmend}
                    onResetModeChange={setResetMode}
                    onCommit={() => void commit()}
                    onPush={() => void push(false)}
                    onForcePush={() => void push(true)}
                    onReset={() => void reset()}
                    disabled={loading}
                  />
                </div>
              </>
            ) : (
              <div className="history-full">
                <HistoryTable
                  commits={snapshot.commits}
                  selectedHash={selectedCommit?.hash}
                  search=""
                  onSelect={(commit) => void inspectCommit(commit)}
                  onDoubleClick={(commit) => void checkoutFromCommit(commit)}
                />
                {selectedCommit ? (
                  <div className="history-diff">
                    <DiffViewer raw={diff} emptyMessage={emptyDiff} />
                  </div>
                ) : null}
              </div>
            )}
          </>
        ) : (
          <div className="empty-state">
            <GitBranch size={36} />
            <h2>Add a repository to start</h2>
            <p>Browse history, stage changes, review diffs, and commit — all in one window.</p>
            <button type="button" className="commit-primary" onClick={chooseRepoFolder}>
              <FolderPlus size={16} />
              Add Repository
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

export default App;
