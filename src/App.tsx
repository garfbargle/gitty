import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderPlus, GitBranch } from "lucide-react";
import { ChangesList, type ChangesListHandle } from "./components/ChangesList";
import { CommitPanel } from "./components/CommitPanel";
import { DiffViewer } from "./components/DiffViewer";
import { HistoryTable } from "./components/HistoryTable";
import { HistoryTimeline } from "./components/HistoryTimeline";
import { SplitPane, type SplitOrientation } from "./components/SplitPane";
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
import { buildChangeEntries, moveChangeSelection } from "./lib/changeEntries";
import {
  buildTimelineItems,
  moveTimelineSelection,
  timelineSelectionIndex,
} from "./lib/timelineNavigation";
import "./App.css";

const emptyDiff = "Select a file or commit to view its diff.";
const MAX_DISCOVERED = 48;

type ViewMode = "working" | "history";
type NavZone = "timeline" | "files";

function shouldIgnoreKeyboardNavigation(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const input = target as HTMLInputElement;
    if (input.type !== "checkbox") return true;
  }
  if (target.isContentEditable) return true;
  return false;
}

function shouldIgnoreEnterShortcut(event: KeyboardEvent): boolean {
  if (shouldIgnoreKeyboardNavigation(event)) return true;
  return (event.target as HTMLElement).tagName === "BUTTON";
}

function App() {
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [discoveredRepos, setDiscoveredRepos] = useState<DiscoveredRepoEntry[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [selectedPath, setSelectedPath] = useState("");
  const [snapshot, setSnapshot] = useState<RepoSnapshot | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("working");
  const [viewingCommit, setViewingCommit] = useState<CommitEntry | null>(null);
  const [commitFiles, setCommitFiles] = useState<FileChange[]>([]);
  const [focus, setFocus] = useState<DiffFocus>(null);
  const [diff, setDiff] = useState(emptyDiff);
  const [commitMessage, setCommitMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [resetMode, setResetMode] = useState<"soft" | "hard">("soft");
  const [remoteName, setRemoteName] = useState("origin");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historySplit, setHistorySplit] = useState(0.55);
  const [historyOrientation, setHistoryOrientation] = useState<SplitOrientation>("vertical");
  const [loading, setLoading] = useState(false);
  const [pushState, setPushState] = useState<"idle" | "pushing" | "done">("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [navZone, setNavZone] = useState<NavZone>("files");

  const selectedCommit = viewingCommit ?? (focus?.kind === "commit" ? focus.commit : null);
  const selectedFile = focus?.kind === "file" ? focus.file : null;
  const selectedFileKey =
    focus?.kind === "file" ? `${focus.section}:${focus.file.path}` : undefined;
  const workingTreeActive = !viewingCommit;

  const branchNames = useMemo(() => {
    const branches = snapshot?.branches ?? [];
    const local = branches.filter((b) => !b.isRemote).map((b) => b.name);
    const remote = branches.filter((b) => b.isRemote).map((b) => b.name);
    return [...local, ...remote];
  }, [snapshot]);

  const savedPaths = useMemo(() => repos.map((repo) => repo.path), [repos]);
  const discoveryStarted = useRef(false);
  const commitMessageRef = useRef<HTMLTextAreaElement>(null);
  const focusRefreshContextRef = useRef({
    selectedPath,
    viewMode,
    viewingCommit,
    focus,
  });
  focusRefreshContextRef.current = { selectedPath, viewMode, viewingCommit, focus };
  const changesListRef = useRef<ChangesListHandle>(null);
  const pushLockRef = useRef(false);
  const pushDoneTimerRef = useRef<number | null>(null);
  const timelineItems = useMemo(
    () => (snapshot ? buildTimelineItems(snapshot.commits) : []),
    [snapshot?.commits],
  );

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
    setViewingCommit(null);
    setCommitFiles([]);
    setFocus(null);
    setDiff(emptyDiff);
    setCommitMessage("");
    setAmend(false);
    setViewMode("working");
    setNavZone("files");
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

  async function refreshWorkingTree() {
    const snap = await refreshRepo();
    if (!snap) return;

    const currentFocus = focusRefreshContextRef.current.focus;
    if (currentFocus?.kind === "file" && currentFocus.section !== "commit") {
      const list =
        currentFocus.section === "unstaged"
          ? snap.changes.filter(isUnstaged)
          : snap.changes.filter(isStaged);
      const match = list.find((file) => file.path === currentFocus.file.path);
      if (match) {
        await inspectFile(match, currentFocus.section);
      } else if (list.length > 0) {
        await inspectFile(list[0], currentFocus.section);
      } else {
        setFocus(null);
        setDiff(emptyDiff);
      }
    }
  }

  const refreshWorkingTreeRef = useRef(refreshWorkingTree);
  refreshWorkingTreeRef.current = refreshWorkingTree;

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused || !active) return;
        const { selectedPath, viewMode, viewingCommit } = focusRefreshContextRef.current;
        if (!selectedPath || viewMode !== "working" || viewingCommit) return;
        void refreshWorkingTreeRef.current();
      })
      .then((fn) => {
        if (active) unlisten = fn;
        else fn();
      });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

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

  async function inspectCommitHistory(commit: CommitEntry, path = selectedPath) {
    setFocus({ kind: "commit", commit });
    const result = await run(() =>
      invoke<string>("commit_diff", { path, commit: commit.hash }),
    );
    if (result !== null) setDiff(result || "This commit has no patch output.");
  }

  async function inspectCommit(commit: CommitEntry, path = selectedPath) {
    setViewingCommit(commit);
    const files = await run(() =>
      invoke<FileChange[]>("commit_files_command", { path, commit: commit.hash }),
    );
    if (files === null) return;

    setCommitFiles(files);
    if (files.length === 0) {
      setFocus(null);
      const result = await run(() =>
        invoke<string>("commit_diff", { path, commit: commit.hash }),
      );
      if (result !== null) setDiff(result || "This commit has no patch output.");
      return;
    }

    await inspectCommitFile(files[0], commit, path);
  }

  async function inspectCommitFile(
    file: FileChange,
    commit: CommitEntry = viewingCommit!,
    path = selectedPath,
  ) {
    setFocus({ kind: "file", file, section: "commit" });
    const result = await run(() =>
      invoke<string>("file_diff", { path, filePath: file.path, commit: commit.hash }),
    );
    if (result !== null) setDiff(result || "This file has no patch in this commit.");
  }

  async function selectWorkingTree() {
    setViewingCommit(null);
    setCommitFiles([]);
    setFocus(null);
    setDiff(emptyDiff);
    const snap = await refreshRepo();
    if (!snap) return;
    const first = snap.changes.find(isUnstaged) ?? snap.changes.find(isStaged);
    if (first) {
      const section: ChangeSection = isUnstaged(first) ? "unstaged" : "staged";
      await inspectFile(first, section);
    }
  }

  async function inspectFile(file: FileChange, section: ChangeSection, path = selectedPath) {
    setViewingCommit(null);
    setCommitFiles([]);
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

  async function handleAmendChange(checked: boolean) {
    setAmend(checked);
    if (!checked || !selectedPath) return;
    if (commitMessage.trim()) return;

    try {
      const message = await invoke<string>("head_commit_message", { path: selectedPath });
      if (message) {
        setCommitMessage((current) => (current.trim() ? current : message));
      }
    } catch {
      // No commits yet or repo unavailable — leave message empty.
    }
  }

  async function commit() {
    const message = commitMessage.trim();
    if (!message) return;
    const result = await run(() =>
      invoke<ActionResult>("commit_repo", { path: selectedPath, message, amend }),
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
    if (!selectedPath || pushLockRef.current || pushState !== "idle") return;
    if (force && !window.confirm("Force push with --force-with-lease?")) return;

    pushLockRef.current = true;
    setPushState("pushing");

    try {
      const result = await run(() =>
        invoke<ActionResult>("push_repo", { path: selectedPath, force }),
      );
      if (result) {
        setMessage([result.message, result.output].filter(Boolean).join("\n"));
        setPushState("done");
        if (pushDoneTimerRef.current !== null) {
          window.clearTimeout(pushDoneTimerRef.current);
        }
        pushDoneTimerRef.current = window.setTimeout(() => {
          setPushState("idle");
          pushDoneTimerRef.current = null;
        }, 1400);
        await refreshRepo();
      } else {
        setPushState("idle");
      }
    } finally {
      pushLockRef.current = false;
    }
  }

  const pushRef = useRef(push);
  pushRef.current = push;

  const stageAllRef = useRef(async () => {});
  stageAllRef.current = async () => {
    const snap = await refreshRepo();
    if (!snap) return;
    const paths = snap.changes.filter(isUnstaged).map((file) => file.path);
    if (paths.length === 0) return;
    await stageFiles(paths);
  };

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
  const hasRemotes = (snapshot?.remotes.length ?? 0) > 0;
  const showCommitSection = workingTreeActive;
  const showResetSection = !!viewingCommit;
  const showSetupRemote = workingTreeActive && !hasRemotes;

  useEffect(() => {
    if (viewMode !== "working" || !workingTreeActive) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (shouldIgnoreEnterShortcut(event)) return;
      event.preventDefault();
      commitMessageRef.current?.focus();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewMode, workingTreeActive]);

  const canPush = hasRemotes && (snapshot?.ahead ?? 0) > 0;

  useEffect(() => {
    if (viewMode !== "working" || !workingTreeActive || !canPush || loading || pushState !== "idle") {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return;
      if (event.key !== "Enter") return;
      event.preventDefault();
      void pushRef.current(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewMode, workingTreeActive, canPush, loading, pushState]);

  useEffect(() => {
    return () => {
      if (pushDoneTimerRef.current !== null) {
        window.clearTimeout(pushDoneTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (viewMode !== "working" || !workingTreeActive || loading) return;

    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "a") return;
      if (shouldIgnoreKeyboardNavigation(event)) return;
      event.preventDefault();
      void stageAllRef.current();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewMode, workingTreeActive, loading]);

  useEffect(() => {
    if (viewMode !== "working" || !snapshot) return;
    const currentSnapshot = snapshot;

    function onKeyDown(event: KeyboardEvent) {
      if (shouldIgnoreKeyboardNavigation(event)) return;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      if (navZone !== "timeline") return;

      event.preventDefault();
      event.stopPropagation();

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const delta = event.key === "ArrowLeft" ? -1 : 1;
        const currentIndex = timelineSelectionIndex(
          timelineItems,
          selectedCommit?.hash,
          workingTreeActive,
        );
        const item = moveTimelineSelection(timelineItems, currentIndex, delta);
        if (!item) return;
        if (item.kind === "working-tree") void selectWorkingTree();
        else void inspectCommit(item.commit);
        return;
      }

      setNavZone("files");
      const changes = viewingCommit ? commitFiles : currentSnapshot.changes;
      const variant = viewingCommit ? "commit" : "working";
      const entries = buildChangeEntries(changes, variant);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const entry = moveChangeSelection(entries, -1, delta);
      if (entry) {
        if (variant === "commit" && viewingCommit) {
          void inspectCommitFile(entry.file, viewingCommit);
        } else {
          void inspectFile(entry.file, entry.section);
        }
      }
      changesListRef.current?.focus();
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    viewMode,
    snapshot,
    navZone,
    timelineItems,
    selectedCommit?.hash,
    workingTreeActive,
    viewingCommit,
    commitFiles,
  ]);

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
              commits={snapshot.commits}
              changeCount={snapshot.changes.length}
              viewMode={viewMode}
              loading={loading}
              pushState={pushState}
              ahead={snapshot.ahead}
              behind={snapshot.behind}
              hasRemotes={hasRemotes}
              onRepoChange={(path) => void selectRepo(path)}
              onBranchChange={(branch) => void checkoutBranch(branch)}
              viewingCommit={viewingCommit}
              onSelectCommit={(commit) => void inspectCommit(commit)}
              onToggleView={() => {
                if (viewMode === "history") {
                  setFocus(null);
                  setDiff(emptyDiff);
                  void selectWorkingTree();
                } else {
                  setViewingCommit(null);
                  setCommitFiles([]);
                }
                setViewMode((mode) => (mode === "working" ? "history" : "working"));
              }}
              onReturnToWorkingTree={() => void selectWorkingTree()}
              onRefresh={() => void refreshRepo()}
              onPush={() => void push(false)}
              onForcePush={() => void push(true)}
              onSetupRemote={() => setSettingsOpen(true)}
            />

            {viewMode === "working" ? (
              <>
                <HistoryTimeline
                  key={snapshot.repo.path}
                  commits={snapshot.commits}
                  changeCount={snapshot.changes.length}
                  selectedHash={selectedCommit?.hash}
                  workingTreeActive={workingTreeActive}
                  onInteract={() => setNavZone("timeline")}
                  onSelect={(commit) => void inspectCommit(commit)}
                  onSelectWorkingTree={() => void selectWorkingTree()}
                />

                <div className="workspace-grid">
                  <ChangesList
                    ref={changesListRef}
                    changes={viewingCommit ? commitFiles : snapshot.changes}
                    variant={viewingCommit ? "commit" : "working"}
                    selectedKey={selectedFileKey}
                    onFocusZone={() => setNavZone("files")}
                    onExitToTimeline={
                      viewingCommit ? () => setNavZone("timeline") : undefined
                    }
                    onSelect={(file, section) => {
                      if (section === "commit" && viewingCommit) {
                        void inspectCommitFile(file, viewingCommit);
                      } else {
                        void inspectFile(file, section);
                      }
                    }}
                    onStage={(files, anchor) => void stageFiles(files, anchor)}
                    onUnstage={(files, anchor) => void unstageFiles(files, anchor)}
                    disabled={loading}
                  />

                  <DiffViewer
                    raw={diff}
                    file={selectedFile}
                    showWorkingTreeBadges={!viewingCommit}
                    emptyMessage={emptyDiff}
                    onUnstage={(path) => void unstageFiles([path])}
                  />

                  <CommitPanel
                    message={commitMessage}
                    messageInputRef={commitMessageRef}
                    branch={snapshot.branch}
                    branches={snapshot.branches ?? []}
                    amend={amend}
                    resetMode={resetMode}
                    selectedCommit={selectedCommit}
                    stagedCount={stagedCount}
                    unstagedCount={unstagedCount}
                    showCommitSection={showCommitSection}
                    showResetSection={showResetSection}
                    showSetupRemote={showSetupRemote}
                    onMessageChange={setCommitMessage}
                    onAmendChange={(checked) => void handleAmendChange(checked)}
                    onResetModeChange={setResetMode}
                    onCommit={() => void commit()}
                    onReset={() => void reset()}
                    onSetupRemote={() => setSettingsOpen(true)}
                    disabled={loading}
                  />
                </div>
              </>
            ) : (
              <div className="history-full">
                <SplitPane
                  orientation={historyOrientation}
                  onOrientationChange={setHistoryOrientation}
                  split={historySplit}
                  onSplitChange={setHistorySplit}
                  primary={
                    <HistoryTable
                      commits={snapshot.commits}
                      selectedHash={selectedCommit?.hash}
                      search=""
                      onSelect={(commit) => void inspectCommitHistory(commit)}
                      onDoubleClick={(commit) => void checkoutFromCommit(commit)}
                    />
                  }
                  secondary={<DiffViewer raw={diff} emptyMessage={emptyDiff} />}
                />
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
