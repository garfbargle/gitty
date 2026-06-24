import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderPlus, GitBranch, RefreshCw } from "lucide-react";
import { ChangesList, type ChangesListHandle } from "./components/ChangesList";
import { CommitPanel } from "./components/CommitPanel";
import { DiffViewer } from "./components/DiffViewer";
import { HistoryTable } from "./components/HistoryTable";
import { HistoryTimeline } from "./components/HistoryTimeline";
import { SplitPane, type SplitOrientation } from "./components/SplitPane";
import { AppSettingsDrawer } from "./components/AppSettingsDrawer";
import { RepoSettingsDrawer } from "./components/RepoSettingsDrawer";
import { RepoSidebar } from "./components/RepoSidebar";
import { TopBar } from "./components/TopBar";
import { GittyEmptyState } from "./components/GittyEmptyState";
import { ResetAllConfirmDialog } from "./components/ResetAllConfirmDialog";
import { TagCreateDialog } from "./components/TagCreateDialog";
import { TagDeleteDialog } from "./components/TagDeleteDialog";
import type { PushPhase } from "./components/PushButton";
import type {
  ActionResult,
  AppSettingsView,
  ChangeSection,
  ChangeSummary,
  CommitEntry,
  DiffFocus,
  DiscoveredRepoEntry,
  FileChange,
  RepoEntry,
  RepoChanges,
  RepoEnrichment,
  RepoSnapshot,
  SelectionAnchor,
} from "./types";
import { applyStageToChanges, changePathsKey, isStaged, isUnstaged, parseRefs, primaryRef, stagedPathsKey, tagName } from "./lib/git";
import { buildChangeEntries, moveChangeSelection } from "./lib/changeEntries";
import {
  appendUniqueCommits,
  COMMIT_PAGE_SIZE,
  commitsPageHasMore,
  INITIAL_COMMIT_LIMIT,
} from "./lib/commits";
import {
  buildTimelineItems,
  moveTimelineSelection,
  timelineSelectionIndex,
} from "./lib/timelineNavigation";
import { pickerCommits } from "./lib/commitDisplay";
import "./App.css";

const emptyDiff = "Select a file or commit to view its diff.";

function discoveredInsertIndex(repos: DiscoveredRepoEntry[], lastEditedAt: number): number {
  let lo = 0;
  let hi = repos.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (repos[mid].lastEditedAt > lastEditedAt) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function upsertDiscoveredRepo(
  current: DiscoveredRepoEntry[],
  repo: DiscoveredRepoEntry,
): DiscoveredRepoEntry[] {
  const existingIndex = current.findIndex((item) => item.path === repo.path);
  if (existingIndex !== -1) {
    const existing = current[existingIndex];
    if (existing.lastEditedAt === repo.lastEditedAt) {
      return current;
    }
    const without = current.slice(0, existingIndex).concat(current.slice(existingIndex + 1));
    const insertAt = discoveredInsertIndex(without, repo.lastEditedAt);
    const next = without.slice();
    next.splice(insertAt, 0, { ...existing, lastEditedAt: repo.lastEditedAt });
    return next;
  }

  const insertAt = discoveredInsertIndex(current, repo.lastEditedAt);
  const next = current.slice();
  next.splice(insertAt, 0, repo);
  return next;
}

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

type SummaryScope = "all" | "staged";

type SummaryCacheEntry = {
  pathsKey: string;
  summary: ChangeSummary;
};

type SummaryCache = {
  all: SummaryCacheEntry | null;
  staged: SummaryCacheEntry | null;
  displayScope: SummaryScope;
};

function emptySummaryCache(): SummaryCache {
  return { all: null, staged: null, displayScope: "all" };
}

const SNAPSHOT_SUPERSEDED = "__superseded__";

function isSupersededSnapshotError(err: unknown): boolean {
  return String(err).includes(SNAPSHOT_SUPERSEDED);
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
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
  const [viewingCommitMessage, setViewingCommitMessage] = useState("");
  const [commitFiles, setCommitFiles] = useState<FileChange[]>([]);
  const [focus, setFocus] = useState<DiffFocus>(null);
  const [diff, setDiff] = useState(emptyDiff);
  const [commitMessage, setCommitMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [pushOnCommit, setPushOnCommit] = useState(false);
  const [resetMode, setResetMode] = useState<"soft" | "hard">("soft");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [repoSettingsOpen, setRepoSettingsOpen] = useState(false);
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const [tagCreateCommit, setTagCreateCommit] = useState<CommitEntry | null>(null);
  const [tagDeleteTarget, setTagDeleteTarget] = useState<{
    commit: CommitEntry;
    name: string;
  } | null>(null);
  const [nvidiaApiKeyConfigured, setNvidiaApiKeyConfigured] = useState(false);
  const [nvidiaApiKeyPreview, setNvidiaApiKeyPreview] = useState<string | null>(null);
  const [autoSummarizeEnabled, setAutoSummarizeEnabled] = useState(true);
  const [nvidiaApiKey, setNvidiaApiKey] = useState("");
  const [settingsNvidiaKey, setSettingsNvidiaKey] = useState("");
  const [nvidiaKeyTesting, setNvidiaKeyTesting] = useState(false);
  const [nvidiaKeyTestMessage, setNvidiaKeyTestMessage] = useState<string | null>(null);
  const [nvidiaKeyTestError, setNvidiaKeyTestError] = useState(false);
  const [changeSummaryScope, setChangeSummaryScope] = useState<SummaryScope>("all");
  const [changeSummary, setChangeSummary] = useState<string | null>(null);
  const [changeSummaryLoading, setChangeSummaryLoading] = useState(false);
  const [changeSummaryError, setChangeSummaryError] = useState<string | null>(null);
  const [changeSummaryVisible, setChangeSummaryVisible] = useState(false);
  const [historySplit, setHistorySplit] = useState(0.55);
  const [historyOrientation, setHistoryOrientation] = useState<SplitOrientation>("vertical");
  const [loading, setLoading] = useState(false);
  const [loadingMoreCommits, setLoadingMoreCommits] = useState(false);
  const [commitsHasMore, setCommitsHasMore] = useState(false);
  const [pushPhase, setPushPhase] = useState<PushPhase>("idle");
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
  const contentPath = snapshot?.repo.path ?? "";
  const displaySnapshot =
    snapshot && snapshot.repo.path === selectedPath ? snapshot : null;
  const repoSwitching = Boolean(selectedPath && contentPath !== selectedPath);
  const switchingRepoName =
    repos.find((repo) => repo.path === selectedPath)?.name ?? "repository";
  const discoveryStarted = useRef(false);
  const selectRepoRequestRef = useRef(0);
  const loadingMoreCommitsRef = useRef(false);
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
  const workingTreeRefreshInFlightRef = useRef(false);
  const focusRefreshTimerRef = useRef<number | null>(null);
  const lastFocusRefreshAtRef = useRef(0);
  const snapshotGenerationRef = useRef(0);
  const FOCUS_REFRESH_DEBOUNCE_MS = 400;
  const FOCUS_REFRESH_MIN_INTERVAL_MS = 2000;
  const summaryCacheRef = useRef<SummaryCache>(emptySummaryCache());
  const summarizeRequestRef = useRef(0);
  const summaryHiddenUntilNewRef = useRef(false);
  const timelineItems = useMemo(
    () => (snapshot ? buildTimelineItems(snapshot.commits, snapshot.aheadCommits ?? []) : []),
    [snapshot?.commits, snapshot?.aheadCommits],
  );
  const historyCommits = useMemo(
    () =>
      snapshot
        ? pickerCommits(snapshot.commits, snapshot.aheadCommits ?? [])
        : [],
    [snapshot?.commits, snapshot?.aheadCommits],
  );

  const startDiscovery = useCallback((paths: string[]) => {
    void invoke("start_repo_discovery", { savedPaths: paths }).catch(() => {
      setDiscovering(false);
    });
  }, []);

  useEffect(() => {
    void loadRepos();
    void loadAppSettings();
  }, []);

  const rescanDiscovery = useCallback(() => {
    startDiscovery(savedPaths);
  }, [savedPaths, startDiscovery]);

  useEffect(() => {
    if (!reposLoaded) return;

    let active = true;
    const unlisteners: Array<() => void> = [];

    void (async () => {
      const onFound = await listen<DiscoveredRepoEntry>("repo-discovery-found", (event) => {
        if (!active) return;
        setDiscoveredRepos((current) => upsertDiscoveredRepo(current, event.payload));
      });
      if (!active) {
        onFound();
        return;
      }
      unlisteners.push(onFound);

      const onStarted = await listen("repo-discovery-started", () => {
        if (!active) return;
        setDiscovering(true);
        setDiscoveredRepos([]);
      });
      if (!active) {
        onStarted();
        return;
      }
      unlisteners.push(onStarted);

      const onFinished = await listen("repo-discovery-finished", () => {
        if (active) setDiscovering(false);
      });
      if (!active) {
        onFinished();
        return;
      }
      unlisteners.push(onFinished);

      if (!discoveryStarted.current) {
        discoveryStarted.current = true;
        startDiscovery(savedPaths);
      }
    })();

    return () => {
      active = false;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [reposLoaded, savedPaths, startDiscovery]);

  useEffect(() => {
    setDiscoveredRepos((current) =>
      current.filter((repo) => !savedPaths.includes(repo.path)),
    );
  }, [savedPaths]);

  useEffect(() => {
    if (!snapshot || viewMode !== "working") return;
    if (snapshot.repo.path !== selectedPath) return;
    const first = snapshot.changes.find(isUnstaged) ?? snapshot.changes.find(isStaged);
    if (first) {
      const section: ChangeSection = isUnstaged(first) ? "unstaged" : "staged";
      void inspectFileQuiet(first, section, snapshot.repo.path);
    }
  }, [snapshot?.repo.path, selectedPath, viewMode]);

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

  async function loadAppSettings() {
    try {
      const settings = await invoke<AppSettingsView>("get_app_settings");
      applyAppSettings(settings);
    } catch {
      setNvidiaApiKeyConfigured(false);
      setNvidiaApiKeyPreview(null);
      setAutoSummarizeEnabled(true);
    }
  }

  function applyAppSettings(settings: AppSettingsView) {
    setNvidiaApiKeyConfigured(settings.nvidiaApiKeyConfigured);
    setNvidiaApiKeyPreview(settings.nvidiaApiKeyPreview ?? null);
    setAutoSummarizeEnabled(settings.autoSummarizeEnabled);
    setPushOnCommit(settings.pushOnCommit);
  }

  async function handlePushOnCommitChange(enabled: boolean) {
    setPushOnCommit(enabled);
    try {
      const settings = await invoke<AppSettingsView>("set_push_on_commit", { enabled });
      applyAppSettings(settings);
    } catch (err) {
      setError(String(err));
    }
  }

  function openRepoSettings() {
    setRepoSettingsOpen(true);
  }

  useEffect(() => {
    if (settingsOpen) {
      void loadAppSettings();
      setNvidiaKeyTestMessage(null);
      setNvidiaKeyTestError(false);
    }
  }, [settingsOpen]);

  async function saveNvidiaApiKeyFromPanel() {
    setChangeSummaryError(null);
    try {
      const settings = await invoke<AppSettingsView>("set_nvidia_api_key", {
        apiKey: nvidiaApiKey,
      });
      applyAppSettings(settings);
      setNvidiaApiKey("");
      summaryCacheRef.current = emptySummaryCache();
      setChangeSummary(null);
      setChangeSummaryScope("all");
      if (settings.nvidiaApiKeyConfigured) {
        setChangeSummaryVisible(true);
        void summarizeChanges("all", true);
      }
    } catch (err) {
      setChangeSummaryError(String(err));
    }
  }

  async function saveNvidiaApiKeyFromSettings() {
    setNvidiaKeyTestMessage(null);
    setNvidiaKeyTestError(false);
    try {
      const settings = await invoke<AppSettingsView>("set_nvidia_api_key", {
        apiKey: settingsNvidiaKey,
      });
      applyAppSettings(settings);
      setSettingsNvidiaKey("");
      resetSummaryCache();
      setNvidiaKeyTestMessage("API key saved.");
      setNvidiaKeyTestError(false);
    } catch (err) {
      setNvidiaKeyTestMessage(String(err));
      setNvidiaKeyTestError(true);
    }
  }

  async function deleteNvidiaApiKey() {
    if (!window.confirm("Remove your saved NVIDIA API key?")) return;
    setNvidiaKeyTestMessage(null);
    setNvidiaKeyTestError(false);
    try {
      const settings = await invoke<AppSettingsView>("delete_nvidia_api_key");
      applyAppSettings(settings);
      setSettingsNvidiaKey("");
      setNvidiaApiKey("");
      resetSummaryCache();
      setChangeSummaryVisible(false);
      setNvidiaKeyTestMessage("API key deleted.");
      setNvidiaKeyTestError(false);
    } catch (err) {
      setNvidiaKeyTestMessage(String(err));
      setNvidiaKeyTestError(true);
    }
  }

  async function testNvidiaApiKey() {
    setNvidiaKeyTesting(true);
    setNvidiaKeyTestMessage(null);
    setNvidiaKeyTestError(false);
    try {
      const draft = settingsNvidiaKey.trim();
      const result = await invoke<ActionResult>("test_nvidia_api_key", {
        apiKey: draft || null,
      });
      setNvidiaKeyTestMessage(result.message);
      setNvidiaKeyTestError(false);
    } catch (err) {
      setNvidiaKeyTestMessage(String(err));
      setNvidiaKeyTestError(true);
    } finally {
      setNvidiaKeyTesting(false);
    }
  }

  async function setAutoSummarizeEnabledSetting(enabled: boolean) {
    try {
      const settings = await invoke<AppSettingsView>("set_auto_summarize_enabled", { enabled });
      applyAppSettings(settings);
    } catch (err) {
      setError(String(err));
    }
  }

  function dismissChangeSummary() {
    summaryHiddenUntilNewRef.current = true;
    setChangeSummaryVisible(false);
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

  async function selectRepo(path: string): Promise<void> {
    if (path === selectedPath && contentPath === path) return;

    const requestId = ++selectRepoRequestRef.current;

    setSelectedPath(path);
    applyRepoSwitchCleanup();

    await waitForPaint();

    const result = await refreshRepoQuiet(path, {
      updateState: false,
      generation: requestId,
      lite: true,
      limit: INITIAL_COMMIT_LIMIT,
    });
    if (requestId !== selectRepoRequestRef.current) return;
    if (result) {
      setSnapshot(result);
      setSelectedPath(result.repo.path);
      setCommitsHasMore(commitsPageHasMore(result.commits.length, INITIAL_COMMIT_LIMIT));
      void enrichRepoSnapshot(path, requestId);
      return;
    }

    setSelectedPath((current) => {
      if (requestId !== selectRepoRequestRef.current) return current;
      return contentPath || current;
    });
  }

  function applyRepoSwitchCleanup() {
    snapshotGenerationRef.current += 1;
    setCommitsHasMore(false);
    setLoadingMoreCommits(false);
    loadingMoreCommitsRef.current = false;
    setViewingCommit(null);
    setViewingCommitMessage("");
    setCommitFiles([]);
    setFocus(null);
    setDiff(emptyDiff);
    setCommitMessage("");
    setAmend(false);
    resetSummaryCache();
    setChangeSummaryVisible(false);
    setViewMode("working");
    setNavZone("files");
    setRepoSettingsOpen(false);
  }

  async function enrichRepoSnapshot(path: string, switchGeneration: number): Promise<void> {
    try {
      const result = await invoke<RepoEnrichment>("repo_enrich", {
        path,
        aheadLimit: INITIAL_COMMIT_LIMIT,
      });
      if (switchGeneration !== selectRepoRequestRef.current) return;
      setSnapshot((prev) =>
        prev && prev.repo.path === path
          ? {
              ...prev,
              aheadCommits: result.aheadCommits,
              aheadBranch: result.aheadBranch,
              tags: result.tags,
              unpushedTags: result.unpushedTags,
            }
          : prev,
      );
    } catch (err) {
      if (switchGeneration !== selectRepoRequestRef.current) return;
      setError(String(err));
    }
  }

  async function loadMoreCommits(): Promise<void> {
    const path = selectedPath;
    if (!path || !commitsHasMore || loadingMoreCommitsRef.current) return;

    loadingMoreCommitsRef.current = true;
    setLoadingMoreCommits(true);
    try {
      const skip = snapshot?.repo.path === path ? snapshot.commits.length : 0;
      const more = await invoke<CommitEntry[]>("repo_commits", {
        path,
        skip,
        limit: COMMIT_PAGE_SIZE,
      });
      if (selectedPath !== path) return;
      setCommitsHasMore(commitsPageHasMore(more.length, COMMIT_PAGE_SIZE));
      if (more.length === 0) return;
      setSnapshot((prev) =>
        prev && prev.repo.path === path
          ? { ...prev, commits: appendUniqueCommits(prev.commits, more) }
          : prev,
      );
    } catch (err) {
      setError(String(err));
    } finally {
      loadingMoreCommitsRef.current = false;
      setLoadingMoreCommits(false);
    }
  }

  async function refreshRepo(path = selectedPath): Promise<RepoSnapshot | null> {
    if (!path) return null;
    const result = await run(() =>
      invoke<RepoSnapshot>("repo_snapshot", {
        path,
        limit: INITIAL_COMMIT_LIMIT,
        lite: false,
      }),
    );
    if (result) {
      setSnapshot(result);
      setSelectedPath(result.repo.path);
      setCommitsHasMore(commitsPageHasMore(result.commits.length, INITIAL_COMMIT_LIMIT));
      return result;
    }
    return null;
  }

  async function refreshRepoQuiet(
    path = selectedPath,
    options?: { updateState?: boolean; generation?: number; lite?: boolean; limit?: number },
  ): Promise<RepoSnapshot | null> {
    if (!path) return null;
    const updateState = options?.updateState !== false;
    const stateGeneration = snapshotGenerationRef.current;
    try {
      const result = await invoke<RepoSnapshot>("repo_snapshot", {
        path,
        limit: options?.limit ?? INITIAL_COMMIT_LIMIT,
        generation: options?.generation ?? null,
        lite: options?.lite ?? false,
      });
      if (updateState && stateGeneration === snapshotGenerationRef.current) {
        setSnapshot(result);
        setSelectedPath(result.repo.path);
      }
      return result;
    } catch (err) {
      if (isSupersededSnapshotError(err)) return null;
      setError(String(err));
      return null;
    }
  }

  async function refreshChangesQuiet(path = selectedPath): Promise<FileChange[] | null> {
    if (!path) return null;
    try {
      const result = await invoke<RepoChanges>("repo_changes", { path });
      setSnapshot((prev) =>
        prev && prev.repo.path === path
          ? { ...prev, changes: result.changes, isClean: result.isClean }
          : prev,
      );
      return result.changes;
    } catch (err) {
      setError(String(err));
      return null;
    }
  }

  function applyChangesOptimistic(files: string[], stage: boolean) {
    snapshotGenerationRef.current += 1;
    setSnapshot((prev) => {
      if (!prev) return prev;
      const changes = applyStageToChanges(prev.changes, files, stage);
      return { ...prev, changes, isClean: changes.length === 0 };
    });
  }

  async function refreshWorkingTree() {
    if (workingTreeRefreshInFlightRef.current) return;
    const { selectedPath: path } = focusRefreshContextRef.current;
    if (!path) return;

    workingTreeRefreshInFlightRef.current = true;
    try {
      const changes = await refreshChangesQuiet(path);
      if (!changes) return;

      const currentFocus = focusRefreshContextRef.current.focus;
      if (currentFocus?.kind === "file" && currentFocus.section !== "commit") {
        const list =
          currentFocus.section === "unstaged"
            ? changes.filter(isUnstaged)
            : changes.filter(isStaged);
        const match = list.find((file) => file.path === currentFocus.file.path);
        if (match) {
          await inspectFileQuiet(match, currentFocus.section, path);
        } else if (list.length > 0) {
          await inspectFileQuiet(list[0], currentFocus.section, path);
        } else {
          setFocus(null);
          setDiff(emptyDiff);
        }
      }
    } finally {
      workingTreeRefreshInFlightRef.current = false;
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
        if (Date.now() - lastFocusRefreshAtRef.current < FOCUS_REFRESH_MIN_INTERVAL_MS) {
          return;
        }
        if (focusRefreshTimerRef.current !== null) {
          window.clearTimeout(focusRefreshTimerRef.current);
        }
        focusRefreshTimerRef.current = window.setTimeout(() => {
          focusRefreshTimerRef.current = null;
          lastFocusRefreshAtRef.current = Date.now();
          void refreshWorkingTreeRef.current();
        }, FOCUS_REFRESH_DEBOUNCE_MS);
      })
      .then((fn) => {
        if (active) unlisten = fn;
        else fn();
      });

    return () => {
      active = false;
      if (focusRefreshTimerRef.current !== null) {
        window.clearTimeout(focusRefreshTimerRef.current);
        focusRefreshTimerRef.current = null;
      }
      unlisten?.();
    };
  }, []);

  async function selectAfterToggle(anchor: SelectionAnchor, changes?: FileChange[]) {
    const list =
      changes ??
      (await refreshChangesQuiet()) ??
      snapshot?.changes ??
      [];

    const sectionList =
      anchor.section === "unstaged"
        ? list.filter(isUnstaged)
        : list.filter(isStaged);

    if (sectionList.length === 0) {
      setFocus(null);
      setDiff(emptyDiff);
      return;
    }

    const index = Math.min(anchor.index, sectionList.length - 1);
    await inspectFileQuiet(sectionList[index], anchor.section);
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

  async function selectWorkingTree(options?: {
    snapshot?: RepoSnapshot | null;
    refresh?: boolean;
  }) {
    setViewingCommit(null);
    setCommitFiles([]);
    setFocus(null);
    setDiff(emptyDiff);

    let snap = options?.snapshot ?? null;
    if (options?.refresh || !snap || snap.repo.path !== selectedPath) {
      snap = await refreshRepoQuiet(selectedPath);
    } else {
      void refreshChangesQuiet(selectedPath);
    }
    if (!snap) return;

    const first = snap.changes.find(isUnstaged) ?? snap.changes.find(isStaged);
    if (first) {
      const section: ChangeSection = isUnstaged(first) ? "unstaged" : "staged";
      await inspectFileQuiet(first, section);
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

  async function inspectFileQuiet(file: FileChange, section: ChangeSection, path = selectedPath) {
    setViewingCommit(null);
    setCommitFiles([]);
    setFocus({ kind: "file", file, section });
    try {
      const result = await invoke<string>("file_diff", { path, filePath: file.path });
      setDiff(result || "This file has no tracked diff.");
    } catch (err) {
      setError(String(err));
    }
  }

  async function checkoutBranch(branch: string) {
    if (!selectedPath || !branch) return;
    const isDetached = snapshot?.branch.includes("detached");
    if (!isDetached && branch === snapshot?.branch) return;
    const result = await run(() =>
      invoke<ActionResult>("checkout_branch", { path: selectedPath, branch }),
    );
    if (result) {
      setMessage(result.message);
      setViewingCommit(null);
      setCommitFiles([]);
      setFocus(null);
      setDiff(emptyDiff);
      await refreshRepo();
    }
  }

  async function resumeBranch() {
    const branch = snapshot?.aheadBranch;
    const tip = snapshot?.aheadCommits?.[0];
    if (!selectedPath || !branch || !tip) return;

    const isDetached = snapshot.branch.includes("detached");
    if (isDetached) {
      await checkoutBranch(branch);
      await selectWorkingTree({ refresh: true });
      return;
    }

    if (
      snapshot.changes.length > 0 &&
      !window.confirm(`Hard reset to latest commit on ${branch}? Uncommitted changes will be lost.`)
    ) {
      return;
    }
    const result = await run(() =>
      invoke<ActionResult>("reset_to_commit", {
        path: selectedPath,
        commit: tip.hash,
        mode: "hard",
      }),
    );
    if (!result) return;
    setMessage(result.message);
    setViewingCommit(null);
    setCommitFiles([]);
    setFocus(null);
    setDiff(emptyDiff);
    const snap = await refreshRepo();
    if (snap) await selectWorkingTree({ snapshot: snap });
  }

  async function checkoutFromCommit(commit: CommitEntry) {
    const ref = primaryRef(commit.refs) || parseRefs(commit.refs)[0];
    if (ref?.startsWith("tag:")) {
      const name = tagName(ref);
      if (!window.confirm(`Check out tag ${name}?`)) return;
      await checkoutBranch(name);
      await selectWorkingTree({ refresh: true });
      return;
    }
    if (ref && !ref.startsWith("tag:")) {
      await checkoutBranch(ref.replace(/^origin\//, "") || ref);
      await selectWorkingTree({ refresh: true });
      return;
    }
    if (!window.confirm(`Check out detached commit ${commit.shortHash}?`)) return;
    const result = await run(() =>
      invoke<ActionResult>("checkout_branch", { path: selectedPath, branch: commit.hash }),
    );
    if (result) {
      setMessage(result.message);
      setViewingCommit(null);
      setCommitFiles([]);
      setFocus(null);
      setDiff(emptyDiff);
      await selectWorkingTree({ refresh: true });
    }
  }

  function openCreateTagDialog(commit: CommitEntry) {
    setTagCreateCommit(commit);
  }

  async function submitCreateTag(name: string) {
    if (!selectedPath || !tagCreateCommit) return;
    const commit = tagCreateCommit;
    const result = await run(() =>
      invoke<ActionResult>("create_tag", {
        path: selectedPath,
        name,
        commit: commit.hash,
      }),
    );
    if (result) {
      setMessage(result.message);
      setTagCreateCommit(null);
      await refreshRepo();
    }
  }

  function openDeleteTagDialog(commit: CommitEntry, name: string) {
    setTagDeleteTarget({ commit, name });
  }

  async function submitDeleteTag() {
    if (!selectedPath || !tagDeleteTarget) return;
    const { name } = tagDeleteTarget;
    const result = await run(() =>
      invoke<ActionResult>("delete_tag", { path: selectedPath, name }),
    );
    if (result) {
      setMessage(result.message);
      setTagDeleteTarget(null);
      await refreshRepo();
    }
  }

  async function stageFiles(files: string[], anchor?: SelectionAnchor) {
    if (!selectedPath || files.length === 0) return;

    setLoading(true);
    setError("");
    let success = false;
    try {
      await invoke<ActionResult>("stage_files", {
        path: selectedPath,
        files,
        stage: true,
      });
      success = true;
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
    if (!success) return;

    applyChangesOptimistic(files, true);
    const changes = await refreshChangesQuiet();
    if (!changes) return;

    if (anchor) {
      await selectAfterToggle(anchor, changes);
      return;
    }

    if (focus?.kind === "file" && files.includes(focus.file.path)) {
      const staged = changes.find((file) => file.path === focus.file.path && isStaged(file));
      if (staged) {
        await inspectFileQuiet(staged, "staged");
      }
    }
  }

  async function unstageFiles(files: string[], anchor?: SelectionAnchor) {
    if (!selectedPath || files.length === 0) return;

    setLoading(true);
    setError("");
    let success = false;
    try {
      await invoke<ActionResult>("stage_files", {
        path: selectedPath,
        files,
        stage: false,
      });
      success = true;
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
    if (!success) return;

    applyChangesOptimistic(files, false);
    const changes = await refreshChangesQuiet();
    if (!changes) return;

    if (anchor) {
      await selectAfterToggle(anchor, changes);
      return;
    }

    if (focus?.kind === "file" && files.includes(focus.file.path)) {
      const unstaged = changes.find((file) => file.path === focus.file.path && isUnstaged(file));
      if (unstaged) {
        await inspectFileQuiet(unstaged, "unstaged");
      }
    }
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

  async function commit(messageOverride?: string) {
    const message = (messageOverride ?? commitMessage).trim();
    if (!message) return;
    const result = await run(() =>
      invoke<ActionResult>("commit_repo", { path: selectedPath, message, amend }),
    );
    if (result) {
      setMessage(result.message);
      setCommitMessage("");
      setAmend(false);
      setChangeSummaryVisible(false);
      resetSummaryCache();
      const snap = await refreshRepo();
      if (pushOnCommit && snap && snap.remotes.length > 0) {
        await push(false);
      }
    }
  }

  function resetSummaryCache() {
    summaryCacheRef.current = emptySummaryCache();
    setChangeSummary(null);
    setChangeSummaryError(null);
    setChangeSummaryScope("all");
    summaryHiddenUntilNewRef.current = false;
  }

  async function summarizeChanges(scope: SummaryScope, force = false) {
    if (!selectedPath || !snapshot) return;

    const pathsKey = changePathsKey(snapshot.changes);
    const stagedKey = stagedPathsKey(snapshot.changes);

    if (scope === "all" && !pathsKey) {
      setChangeSummary(null);
      setChangeSummaryError(null);
      return;
    }

    if (scope === "staged" && !stagedKey) {
      setChangeSummaryError("No staged changes to summarize.");
      return;
    }

    if (!nvidiaApiKeyConfigured) {
      setChangeSummary(null);
      setChangeSummaryError(null);
      return;
    }

    const cache = summaryCacheRef.current;
    const cacheKey = scope === "all" ? pathsKey : stagedKey;
    const cachedEntry = scope === "all" ? cache.all : cache.staged;

    if (!force && cachedEntry?.pathsKey === cacheKey) {
      summaryCacheRef.current = { ...cache, displayScope: scope };
      setChangeSummary(cachedEntry.summary.summary);
      setChangeSummaryScope(scope);
      setChangeSummaryError(null);
      if (!summaryHiddenUntilNewRef.current) {
        setChangeSummaryVisible(true);
      }
      return;
    }

    summaryHiddenUntilNewRef.current = false;
    setChangeSummaryVisible(true);
    const requestId = ++summarizeRequestRef.current;
    setChangeSummaryLoading(true);
    setChangeSummaryError(null);

    try {
      const result = await invoke<ChangeSummary>("summarize_changes", {
        path: selectedPath,
        scope,
      });
      if (requestId !== summarizeRequestRef.current) return;

      const entry = { pathsKey: cacheKey, summary: result };
      summaryCacheRef.current = {
        all: scope === "all" ? entry : summaryCacheRef.current.all,
        staged: scope === "staged" ? entry : summaryCacheRef.current.staged,
        displayScope: scope,
      };
      setChangeSummary(result.summary);
      setChangeSummaryScope(scope);
    } catch (err) {
      if (requestId !== summarizeRequestRef.current) return;
      setChangeSummary(null);
      setChangeSummaryError(String(err));
    } finally {
      if (requestId === summarizeRequestRef.current) {
        setChangeSummaryLoading(false);
      }
    }
  }

  async function summarizeChangesForCommit() {
    if (!autoSummarizeEnabled) return;
    await summarizeChanges("all", false);
  }

  async function resummarizeStagedChanges() {
    summaryHiddenUntilNewRef.current = false;
    await summarizeChanges("staged", true);
  }

  function restoreAllChangesSummary() {
    if (!snapshot) return;
    const cache = summaryCacheRef.current;
    const pathsKey = changePathsKey(snapshot.changes);
    if (!cache.all || cache.all.pathsKey !== pathsKey) return;
    summaryCacheRef.current = { ...cache, displayScope: "all" };
    setChangeSummary(cache.all.summary.summary);
    setChangeSummaryScope("all");
    setChangeSummaryError(null);
  }

  function handleCommitMessageFocus() {
    if (!snapshot || snapshot.changes.length === 0) return;
    if (autoSummarizeEnabled && nvidiaApiKeyConfigured) {
      void summarizeChangesForCommit();
      return;
    }
    if (!nvidiaApiKeyConfigured && !summaryHiddenUntilNewRef.current) {
      setChangeSummaryVisible(true);
    }
  }

  function useChangeSummary() {
    if (!changeSummary) return;
    summaryHiddenUntilNewRef.current = true;
    setCommitMessage(changeSummary);
    setChangeSummaryVisible(false);
    commitMessageRef.current?.focus();
  }

  function useChangeSummaryAndCommit() {
    if (!changeSummary?.trim()) return;
    summaryHiddenUntilNewRef.current = true;
    setChangeSummaryVisible(false);
    void commit(changeSummary);
  }

  async function fetchRepo() {
    const result = await run(() => invoke<ActionResult>("fetch_repo", { path: selectedPath }));
    if (result) {
      setMessage(result.message);
      await refreshRepo();
    }
  }

  async function push(force: boolean): Promise<boolean> {
    if (!selectedPath || pushLockRef.current || pushPhase !== "idle") return false;
    if (force && !window.confirm("Force push with --force-with-lease?")) return false;

    pushLockRef.current = true;
    setPushPhase("pushing");
    setError("");
    setMessage("");
    await waitForPaint();

    try {
      const result = await invoke<ActionResult>("push_repo", { path: selectedPath, force });
      setMessage([result.message, result.output].filter(Boolean).join("\n"));
      const snap = await refreshRepoQuiet(selectedPath);
      const remaining = (snap?.ahead ?? 0) + (snap?.unpushedTags?.length ?? 0);
      if (remaining === 0) {
        if (pushDoneTimerRef.current !== null) {
          window.clearTimeout(pushDoneTimerRef.current);
          pushDoneTimerRef.current = null;
        }
        setPushPhase("idle");
      } else {
        setPushPhase("done");
        if (pushDoneTimerRef.current !== null) {
          window.clearTimeout(pushDoneTimerRef.current);
        }
        pushDoneTimerRef.current = window.setTimeout(() => {
          setPushPhase("idle");
          pushDoneTimerRef.current = null;
        }, 1600);
      }
      return true;
    } catch (err) {
      setError(String(err));
      setPushPhase("idle");
      await refreshRepoQuiet(selectedPath);
      return false;
    } finally {
      pushLockRef.current = false;
    }
  }

  const pushRef = useRef(push);
  pushRef.current = push;

  const stageAllRef = useRef(async () => {});
  stageAllRef.current = async () => {
    if (!selectedPath || !snapshot || snapshot.repo.path !== selectedPath) return;
    const paths = snapshot.changes.filter(isUnstaged).map((file) => file.path);
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

  async function resetAllWorkingTree(includeUntracked: boolean) {
    if (!selectedPath) return;
    const result = await run(() =>
      invoke<ActionResult>("reset_working_tree", {
        path: selectedPath,
        includeUntracked,
      }),
    );
    if (!result) return;
    setResetAllOpen(false);
    setFocus(null);
    setDiff(emptyDiff);
    setChangeSummaryVisible(false);
    resetSummaryCache();
    setMessage([result.message, result.output].filter(Boolean).join("\n"));
    await refreshRepo();
  }

  async function saveRemote(name: string, url: string): Promise<boolean> {
    const result = await run(() =>
      invoke<ActionResult>("set_remote", { path: selectedPath, name, url }),
    );
    if (result) {
      setMessage(result.message);
      await refreshRepo();
      return true;
    }
    return false;
  }

  async function removeRemote(name: string): Promise<boolean> {
    const result = await run(() =>
      invoke<ActionResult>("remove_remote", { path: selectedPath, name }),
    );
    if (result) {
      setMessage(result.message);
      await refreshRepo();
      return true;
    }
    return false;
  }

  async function removeRepo(path: string) {
    const repo = repos.find((item) => item.path === path);
    if (!repo) return;
    if (!window.confirm(`Remove ${repo.name} from Gitty?`)) return;
    const result = await run(() => invoke<RepoEntry[]>("remove_repo", { path }));
    if (result) {
      setRepos(result);
      setSettingsOpen(false);
      setRepoSettingsOpen(false);
      if (path === selectedPath) {
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
  }

  async function removeSelectedRepo() {
    if (!snapshot) return;
    await removeRepo(snapshot.repo.path);
  }

  const stagedCount = snapshot?.changes.filter(isStaged).length ?? 0;
  const unstagedCount = snapshot?.changes.filter(isUnstaged).length ?? 0;
  const changeCount = snapshot?.changes.length ?? 0;
  const allPathsKey = snapshot ? changePathsKey(snapshot.changes) : "";
  const allSummaryAvailable =
    !!snapshot &&
    summaryCacheRef.current.all?.pathsKey === allPathsKey &&
    allPathsKey.length > 0;
  const showResummarizeStaged =
    !!changeSummary &&
    stagedCount > 0 &&
    stagedCount < changeCount &&
    changeSummaryScope === "all";
  const canShowAllChangesSummary = changeSummaryScope === "staged" && allSummaryAvailable;

  useEffect(() => {
    if (!snapshot) return;
    const pathsKey = changePathsKey(snapshot.changes);
    const stagedKey = stagedPathsKey(snapshot.changes);
    const cache = summaryCacheRef.current;

    if (cache.all && cache.all.pathsKey !== pathsKey) {
      resetSummaryCache();
      return;
    }

    if (cache.staged && cache.staged.pathsKey !== stagedKey) {
      summaryHiddenUntilNewRef.current = false;
      summaryCacheRef.current = {
        ...cache,
        staged: null,
        displayScope: cache.displayScope === "staged" ? "all" : cache.displayScope,
      };
      if (cache.displayScope === "staged" && cache.all) {
        setChangeSummary(cache.all.summary.summary);
        setChangeSummaryScope("all");
      }
    }
  }, [snapshot?.changes, snapshot?.repo.path]);
  const hasRemotes = (snapshot?.remotes.length ?? 0) > 0;
  const showCommitSection = workingTreeActive;
  const showResetSection = !!viewingCommit;

  useEffect(() => {
    if (!viewingCommit || !selectedPath) {
      setViewingCommitMessage("");
      return;
    }

    let active = true;
    void (async () => {
      try {
        const text = await invoke<string>("commit_message", {
          path: selectedPath,
          commit: viewingCommit.hash,
        });
        if (active) setViewingCommitMessage(text);
      } catch {
        if (active) setViewingCommitMessage(viewingCommit.subject);
      }
    })();

    return () => {
      active = false;
    };
  }, [viewingCommit, selectedPath]);
  const showSetupRemote = workingTreeActive && !hasRemotes;
  const showGittyEmptyState = workingTreeActive && changeCount === 0;

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

  const canPush =
    hasRemotes && ((snapshot?.ahead ?? 0) > 0 || (snapshot?.unpushedTags?.length ?? 0) > 0);
  const unpushedTagSet = useMemo(
    () => new Set(snapshot?.unpushedTags ?? []),
    [snapshot?.unpushedTags],
  );

  useEffect(() => {
    if (!canPush || pushPhase !== "idle") return;

    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return;
      if (event.key !== "Enter") return;
      event.preventDefault();
      void pushRef.current(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canPush, pushPhase]);

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
        contentPath={contentPath}
        onSelect={(path) => void selectRepo(path)}
        onSaveDiscovered={(path) => void saveDiscoveredRepo(path)}
        onRemoveRepo={(path) => void removeRepo(path)}
        onAddExisting={() => void chooseRepoFolder()}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenRepoSettings={(path) => {
          if (path !== selectedPath) {
            void selectRepo(path).then(() => openRepoSettings());
          } else {
            openRepoSettings();
          }
        }}
        onRescanDiscovery={rescanDiscovery}
      />

      <section className={`main-area${repoSwitching ? " repo-switching" : ""}`}>
        {repoSwitching ? (
          <>
            <TopBar
              repos={repos}
              selectedPath={selectedPath}
              branch="…"
              branches={["…"]}
              commits={[]}
              changeCount={0}
              viewMode={viewMode}
              loading
              repoSwitching
              onRepoChange={(path) => void selectRepo(path)}
              onBranchChange={() => {}}
              onToggleView={() => {}}
              onReturnToWorkingTree={() => {}}
              onSelectCommit={() => {}}
              onRefresh={() => {}}
            />
            <div className="repo-loading-state" aria-busy="true" aria-live="polite">
              <RefreshCw size={28} className="spin" aria-hidden="true" />
              <p>
                Loading <strong>{switchingRepoName}</strong>…
              </p>
            </div>
          </>
        ) : displaySnapshot ? (
          <>
            <TopBar
              repos={repos}
              selectedPath={selectedPath}
              branch={displaySnapshot.branch}
              branches={branchNames.length > 0 ? branchNames : [displaySnapshot.branch]}
              commits={displaySnapshot.commits}
              aheadCommits={displaySnapshot.aheadCommits ?? []}
              aheadBranch={displaySnapshot.aheadBranch}
              changeCount={displaySnapshot.changes.length}
              viewMode={viewMode}
              loading={loading}
              pushPhase={pushPhase}
              ahead={displaySnapshot.ahead}
              behind={displaySnapshot.behind}
              unpushedTags={displaySnapshot.unpushedTags?.length ?? 0}
              hasRemotes={hasRemotes}
              onRepoChange={(path) => void selectRepo(path)}
              onBranchChange={(branch) => void checkoutBranch(branch)}
              viewingCommit={viewingCommit}
              onSelectCommit={(commit) => void inspectCommit(commit)}
              onResumeBranch={() => void resumeBranch()}
              onToggleView={() => {
                if (viewMode === "history") {
                  setViewingCommit(null);
                  setCommitFiles([]);
                  setFocus(null);
                  setDiff(emptyDiff);
                } else {
                  setViewingCommit(null);
                  setCommitFiles([]);
                }
                setViewMode((mode) => (mode === "working" ? "history" : "working"));
              }}
              onReturnToWorkingTree={() => void selectWorkingTree()}
              onRefresh={() => void refreshRepo()}
              onPush={() => push(false)}
              onForcePush={() => push(true)}
              onSetupRemote={() => openRepoSettings()}
            />

            {viewMode === "working" ? (
              <div className="working-view">
                <HistoryTimeline
                  key={displaySnapshot.repo.path}
                  commits={displaySnapshot.commits}
                  aheadCommits={displaySnapshot.aheadCommits ?? []}
                  changeCount={displaySnapshot.changes.length}
                  unpushedTags={unpushedTagSet}
                  selectedHash={selectedCommit?.hash}
                  workingTreeActive={workingTreeActive}
                  onInteract={() => setNavZone("timeline")}
                  onSelect={(commit) => void inspectCommit(commit)}
                  onSelectWorkingTree={() => void selectWorkingTree()}
                  onCreateTag={(commit) => openCreateTagDialog(commit)}
                  onDeleteTag={(commit, name) => openDeleteTagDialog(commit, name)}
                />

                {showGittyEmptyState ? (
                  <GittyEmptyState projectName={displaySnapshot.repo.name} />
                ) : (
                  <div className="workspace-grid">
                    <ChangesList
                      ref={changesListRef}
                      changes={viewingCommit ? commitFiles : displaySnapshot.changes}
                      repoPath={selectedPath}
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
                      onResetAll={
                        workingTreeActive && displaySnapshot.changes.length > 0
                          ? () => setResetAllOpen(true)
                          : undefined
                      }
                      disabled={loading}
                    />

                    <DiffViewer
                      raw={diff}
                      file={selectedFile}
                      repoPath={selectedPath}
                      section={focus?.kind === "file" ? focus.section : undefined}
                      commit={focus?.kind === "commit" ? focus.commit.hash : viewingCommit?.hash}
                      showWorkingTreeBadges={!viewingCommit}
                      emptyMessage={emptyDiff}
                      onUnstage={(path) => void unstageFiles([path])}
                    />

                    <CommitPanel
                      message={commitMessage}
                      messageInputRef={commitMessageRef}
                      branch={displaySnapshot.branch}
                      branches={displaySnapshot.branches ?? []}
                      amend={amend}
                      pushOnCommit={pushOnCommit}
                      hasRemotes={hasRemotes}
                      resetMode={resetMode}
                      selectedCommit={selectedCommit}
                      selectedCommitMessage={viewingCommitMessage}
                      stagedCount={stagedCount}
                      unstagedCount={unstagedCount}
                      changeCount={changeCount}
                      showCommitSection={showCommitSection}
                      showResetSection={showResetSection}
                      showSetupRemote={showSetupRemote}
                      nvidiaApiKey={nvidiaApiKey}
                      nvidiaApiKeyConfigured={nvidiaApiKeyConfigured}
                      changeSummary={changeSummary}
                      changeSummaryLoading={changeSummaryLoading}
                      changeSummaryError={changeSummaryError}
                      changeSummaryVisible={changeSummaryVisible}
                      changeSummaryScope={changeSummaryScope}
                      showResummarizeStaged={showResummarizeStaged}
                      showAllChangesSummary={canShowAllChangesSummary}
                      onMessageChange={setCommitMessage}
                      onMessageFocus={handleCommitMessageFocus}
                      onUseSummary={useChangeSummary}
                      onUseSummaryAndCommit={useChangeSummaryAndCommit}
                      onDismissSummary={dismissChangeSummary}
                      onResummarizeStaged={() => void resummarizeStagedChanges()}
                      onShowAllChangesSummary={restoreAllChangesSummary}
                      onNvidiaApiKeyChange={setNvidiaApiKey}
                      onSaveNvidiaApiKey={() => void saveNvidiaApiKeyFromPanel()}
                      onAmendChange={(checked) => void handleAmendChange(checked)}
                      onPushOnCommitChange={(checked) => void handlePushOnCommitChange(checked)}
                      onResetModeChange={setResetMode}
                      onCommit={() => void commit()}
                      onReset={() => void reset()}
                      onSetupRemote={() => openRepoSettings()}
                      disabled={loading}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="history-full">
                <SplitPane
                  orientation={historyOrientation}
                  onOrientationChange={setHistoryOrientation}
                  split={historySplit}
                  onSplitChange={setHistorySplit}
                  primary={
                    <HistoryTable
                      commits={historyCommits}
                      hasMore={commitsHasMore}
                      loadingMore={loadingMoreCommits}
                      onLoadMore={() => void loadMoreCommits()}
                      aheadHashes={
                        displaySnapshot.aheadCommits?.length
                          ? new Set(displaySnapshot.aheadCommits.map((commit) => commit.hash))
                          : undefined
                      }
                      unpushedTags={unpushedTagSet}
                      selectedHash={selectedCommit?.hash}
                      search=""
                      onSelect={(commit) => void inspectCommitHistory(commit)}
                      onDoubleClick={(commit) => void checkoutFromCommit(commit)}
                      onCreateTag={(commit) => openCreateTagDialog(commit)}
                      onDeleteTag={(commit, name) => openDeleteTagDialog(commit, name)}
                    />
                  }
                  secondary={
                    <DiffViewer
                      raw={diff}
                      repoPath={selectedPath}
                      commit={selectedCommit?.hash}
                      emptyMessage={emptyDiff}
                    />
                  }
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
        <>
          <ResetAllConfirmDialog
            open={resetAllOpen}
            repoName={snapshot.repo.name}
            changes={snapshot.changes}
            loading={loading}
            onConfirm={(includeUntracked) => void resetAllWorkingTree(includeUntracked)}
            onCancel={() => setResetAllOpen(false)}
          />
          <TagCreateDialog
            open={!!tagCreateCommit}
            commit={tagCreateCommit}
            recentTags={snapshot.tags ?? []}
            loading={loading}
            onConfirm={(name) => void submitCreateTag(name)}
            onCancel={() => setTagCreateCommit(null)}
          />
          <TagDeleteDialog
            open={!!tagDeleteTarget}
            commit={tagDeleteTarget?.commit ?? null}
            tagName={tagDeleteTarget?.name ?? ""}
            loading={loading}
            onConfirm={() => void submitDeleteTag()}
            onCancel={() => setTagDeleteTarget(null)}
          />
          <RepoSettingsDrawer
            open={repoSettingsOpen}
            repoName={snapshot.repo.name}
            remotes={snapshot.remotes}
            onClose={() => setRepoSettingsOpen(false)}
            onSaveRemote={saveRemote}
            onRemoveRemote={removeRemote}
            onFetch={() => void fetchRepo()}
            onRemoveRepo={() => void removeSelectedRepo()}
            disabled={loading}
          />
        </>
      ) : null}

      <AppSettingsDrawer
        open={settingsOpen}
        autoSummarizeEnabled={autoSummarizeEnabled}
        nvidiaApiKeyConfigured={nvidiaApiKeyConfigured}
        nvidiaApiKeyPreview={nvidiaApiKeyPreview}
        settingsNvidiaKey={settingsNvidiaKey}
        nvidiaKeyTesting={nvidiaKeyTesting}
        nvidiaKeyTestMessage={nvidiaKeyTestMessage}
        nvidiaKeyTestError={nvidiaKeyTestError}
        onClose={() => setSettingsOpen(false)}
        onAutoSummarizeEnabledChange={(enabled) => void setAutoSummarizeEnabledSetting(enabled)}
        onSettingsNvidiaKeyChange={setSettingsNvidiaKey}
        onSaveNvidiaApiKey={() => void saveNvidiaApiKeyFromSettings()}
        onDeleteNvidiaApiKey={() => void deleteNvidiaApiKey()}
        onTestNvidiaApiKey={() => void testNvidiaApiKey()}
        disabled={loading}
      />
    </main>
  );
}

export default App;
