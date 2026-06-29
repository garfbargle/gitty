import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderPlus, GitBranch, PanelLeft, RefreshCw } from "lucide-react";
import { ChangesList, type ChangesListHandle } from "./components/ChangesList";
import { CommitPanel } from "./components/CommitPanel";
import { MergePanel } from "./components/MergePanel";
import { ConflictResolver } from "./components/ConflictResolver";
import { DiffViewer } from "./components/DiffViewer";
import { buildDiffBundles, type DiffFileBundle } from "./lib/diff";
import { HistoryTable } from "./components/HistoryTable";
import { HistoryTimeline } from "./components/HistoryTimeline";
import { SplitPane, type SplitOrientation } from "./components/SplitPane";
import { AppSettingsDrawer } from "./components/AppSettingsDrawer";
import { RepoSettingsDrawer } from "./components/RepoSettingsDrawer";
import { RepoSidebar } from "./components/RepoSidebar";
import { TopBar } from "./components/TopBar";
import { GittyEmptyState } from "./components/GittyEmptyState";
import { ResetAllConfirmDialog } from "./components/ResetAllConfirmDialog";
import { DiscardFilesConfirmDialog } from "./components/DiscardFilesConfirmDialog";
import { TagCreateDialog } from "./components/TagCreateDialog";
import { BranchCreateDialog } from "./components/BranchCreateDialog";
import { TagDeleteDialog } from "./components/TagDeleteDialog";
import {
  VisitCommitDialog,
  type VisitCommitDialogAction,
} from "./components/VisitCommitDialog";
import type { PushPhase } from "./components/PushButton";
import type {
  ActionResult,
  AppSettingsView,
  ChangeSection,
  ChangeSelectionEntry,
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
  VisitSession,
  MergeAnalysis,
  MergeOutcome,
  MergeStatus,
  MergeSession,
  ConflictSides,
} from "./types";
import { applyStageToChanges, changePathsKey, isStaged, isUnstaged, stagedPathsKey } from "./lib/git";
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
  return { all: null, staged: null, displayScope: "staged" };
}

const SNAPSHOT_SUPERSEDED = "__superseded__";
const SIDEBAR_VISIBLE_KEY = "gitty.sidebarVisible";

function readSidebarVisible(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_VISIBLE_KEY) !== "false";
  } catch {
    return true;
  }
}

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
  const [visitSession, setVisitSession] = useState<VisitSession | null>(null);
  const [visitCommitDialogOpen, setVisitCommitDialogOpen] = useState(false);
  const [visitCommitTarget, setVisitCommitTarget] = useState<CommitEntry | null>(null);
  const [commitFiles, setCommitFiles] = useState<FileChange[]>([]);
  const [mergeSession, setMergeSession] = useState<MergeSession | null>(null);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [mergeAnalysis, setMergeAnalysis] = useState<MergeAnalysis | null>(null);
  const [mergeAnalysisLoading, setMergeAnalysisLoading] = useState(false);
  const [mergeRunning, setMergeRunning] = useState(false);
  const [mergePushed, setMergePushed] = useState(false);
  const [conflictFiles, setConflictFiles] = useState<string[]>([]);
  const [resolvedFiles, setResolvedFiles] = useState<string[]>([]);
  const [selectedConflict, setSelectedConflict] = useState<string | null>(null);
  const [conflictSides, setConflictSides] = useState<ConflictSides | null>(null);
  const [conflictSidesLoading, setConflictSidesLoading] = useState(false);
  const [focus, setFocus] = useState<DiffFocus>(null);
  const [diff, setDiff] = useState(emptyDiff);
  const [diffBundles, setDiffBundles] = useState<DiffFileBundle[]>([]);
  const [diffSelection, setDiffSelection] = useState<ChangeSelectionEntry[]>([]);

  useEffect(() => {
    if (diff === emptyDiff) {
      setDiffBundles([]);
    }
  }, [diff]);
  const [commitMessage, setCommitMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [pushOnCommit, setPushOnCommit] = useState(false);
  const [resetMode, setResetMode] = useState<"soft" | "hard">("soft");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [repoSettingsOpen, setRepoSettingsOpen] = useState(false);
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const [discardFilesOpen, setDiscardFilesOpen] = useState(false);
  const [discardFilesTarget, setDiscardFilesTarget] = useState<string[]>([]);
  const [tagCreateCommit, setTagCreateCommit] = useState<CommitEntry | null>(null);
  const [branchCreateOpen, setBranchCreateOpen] = useState(false);
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
  const [changeSummaryScope, setChangeSummaryScope] = useState<SummaryScope>("staged");
  const [changeSummary, setChangeSummary] = useState<string | null>(null);
  const [changeSummaryLoading, setChangeSummaryLoading] = useState(false);
  const [changeSummaryError, setChangeSummaryError] = useState<string | null>(null);
  const [changeSummaryVisible, setChangeSummaryVisible] = useState(false);
  const [historySplit, setHistorySplit] = useState(0.55);
  const [historyOrientation, setHistoryOrientation] = useState<SplitOrientation>("vertical");
  const [workspaceSplit, setWorkspaceSplit] = useState(0.3);
  const [loading, setLoading] = useState(false);
  const [loadingMoreCommits, setLoadingMoreCommits] = useState(false);
  const [commitsHasMore, setCommitsHasMore] = useState(false);
  const [pushPhase, setPushPhase] = useState<PushPhase>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [navZone, setNavZone] = useState<NavZone>("files");
  const [sidebarVisible, setSidebarVisible] = useState(readSidebarVisible);

  const toggleSidebar = useCallback(() => {
    setSidebarVisible((current) => {
      const next = !current;
      try {
        localStorage.setItem(SIDEBAR_VISIBLE_KEY, String(next));
      } catch {
        // ignore storage failures
      }
      return next;
    });
  }, []);

  const selectedCommit =
    viewingCommit ??
    visitSession?.visitedCommit ??
    (focus?.kind === "commit" ? focus.commit : null);
  const selectedFile = focus?.kind === "file" ? focus.file : null;
  const selectedFileKey =
    focus?.kind === "file" ? `${focus.section}:${focus.file.path}` : undefined;
  const workingTreeActive = !viewingCommit && !visitSession;

  const branchNames = useMemo(() => {
    const branches = snapshot?.branches ?? [];
    const local = branches.filter((b) => !b.isRemote).map((b) => b.name);
    const remote = branches.filter((b) => b.isRemote).map((b) => b.name);
    return [...local, ...remote];
  }, [snapshot]);

  // The project's integration branch (the trunk you ship into).
  const integrationBranch = useMemo(() => {
    const locals = (snapshot?.branches ?? [])
      .filter((b) => !b.isRemote)
      .map((b) => b.name);
    if (locals.includes("main")) return "main";
    if (locals.includes("master")) return "master";
    return null;
  }, [snapshot?.branches]);

  // You're sitting on the trunk — there's nothing to "ship", so no merge strip.
  const onIntegrationBranch =
    !!snapshot && !!integrationBranch && snapshot.branch === integrationBranch;

  // Local branches the current branch could be merged into (excludes itself).
  const mergeCandidates = useMemo(() => {
    const current = snapshot?.branch;
    return (snapshot?.branches ?? [])
      .filter((b) => !b.isRemote && b.name !== current && !b.name.includes("detached"))
      .map((b) => b.name);
  }, [snapshot?.branches, snapshot?.branch]);

  // On the trunk you pull a sibling IN; elsewhere you ship the current branch UP.
  const mergeIncoming = onIntegrationBranch;

  // The "other" branch in the relationship. There is no default in either
  // direction — the strip stays a neutral "Merge…" picker until you explicitly
  // pick a branch, and clearing the pick returns it to that resting state. A
  // saved pick is honored only while it's still a valid candidate.
  const mergePartner = useMemo(() => {
    if (mergeTarget && mergeCandidates.includes(mergeTarget)) return mergeTarget;
    return null;
  }, [mergeTarget, mergeCandidates]);

  // Resolved source → target. On the trunk the partner is the source (merged
  // in); on a feature branch the current branch is the source (shipped up).
  const mergePair = useMemo(() => {
    const current = snapshot?.branch;
    if (!mergePartner || !current || current.includes("detached")) return null;
    return mergeIncoming
      ? { source: mergePartner, target: current }
      : { source: current, target: mergePartner };
  }, [mergePartner, mergeIncoming, snapshot?.branch]);

  // The strip is available whenever there's at least one other local branch to
  // merge with. When no partner is chosen yet it just shows a "Merge a branch…"
  // picker — no forced target, no chips.
  const mergeStripAvailable = mergeCandidates.length > 0;

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
  const selectionPreserveRef = useRef(0);
  const loadDiffRequestRef = useRef(0);
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
        ? pickerCommits(snapshot.graphCommits ?? snapshot.commits, snapshot.aheadCommits ?? [])
        : [],
    [snapshot?.graphCommits, snapshot?.commits, snapshot?.aheadCommits],
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
      setChangeSummaryScope("staged");
      if (settings.nvidiaApiKeyConfigured) {
        setChangeSummaryVisible(true);
        void summarizeChanges("staged", true);
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
      setCommitsHasMore(commitsPageHasMore(result.graphCommits.length, INITIAL_COMMIT_LIMIT));
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
    setVisitSession(null);
    setVisitCommitDialogOpen(false);
    setVisitCommitTarget(null);
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
    setMergeSession(null);
    setMergeTarget(null);
    setMergeAnalysis(null);
    mergeAnalysisKeyRef.current = "";
    setConflictFiles([]);
    setResolvedFiles([]);
    setSelectedConflict(null);
    setConflictSides(null);
    setMergePushed(false);
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
      const skip = snapshot?.repo.path === path ? snapshot.graphCommits.length : 0;
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
          ? { ...prev, graphCommits: appendUniqueCommits(prev.graphCommits, more) }
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
      setCommitsHasMore(commitsPageHasMore(result.graphCommits.length, INITIAL_COMMIT_LIMIT));
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

  function refreshSelectionEntries(
    prior: ChangeSelectionEntry[],
    changes: FileChange[],
  ): ChangeSelectionEntry[] {
    const refreshed: ChangeSelectionEntry[] = [];
    for (const entry of prior) {
      const unstaged = changes.find((file) => file.path === entry.file.path && isUnstaged(file));
      const staged = changes.find((file) => file.path === entry.file.path && isStaged(file));
      if (entry.section === "staged" && staged) {
        refreshed.push({ file: staged, section: "staged" });
      } else if (entry.section === "unstaged" && unstaged) {
        refreshed.push({ file: unstaged, section: "unstaged" });
      } else if (unstaged) {
        refreshed.push({ file: unstaged, section: "unstaged" });
      } else if (staged) {
        refreshed.push({ file: staged, section: "staged" });
      }
    }
    return refreshed;
  }

  function selectionPathsKey(selection: ChangeSelectionEntry[]) {
    return selection
      .map((entry) => `${entry.section}:${entry.file.path}`)
      .sort()
      .join("|");
  }

  function focusAfterToggle(
    toggledPaths: Set<string>,
    remaining: ChangeSelectionEntry[],
  ) {
    if (remaining.length === 0) return;
    if (focus?.kind !== "file" || !toggledPaths.has(focus.file.path)) return;
    const next = remaining[remaining.length - 1];
    setFocus({ kind: "file", file: next.file, section: next.section });
  }

  async function resolveSelectionAfterToggle(
    files: string[],
    changes: FileChange[],
    anchor: SelectionAnchor,
    selectionAlreadyUpdated: boolean,
  ) {
    const toggledPaths = new Set(files);
    const baseRemaining =
      anchor.remainingSelection ??
      diffSelection.filter((entry) => !toggledPaths.has(entry.file.path));
    const newSelection = refreshSelectionEntries(baseRemaining, changes);

    if (newSelection.length === 0) {
      await selectAfterToggle(anchor, changes);
      return;
    }

    focusAfterToggle(toggledPaths, newSelection);
    setDiffSelection(newSelection);

    if (selectionAlreadyUpdated) return;

    const primary =
      (focus?.kind === "file" && !toggledPaths.has(focus.file.path)
        ? newSelection.find((entry) => entry.file.path === focus.file.path)
        : undefined) ?? newSelection[newSelection.length - 1];
    setFocus({ kind: "file", file: primary.file, section: primary.section });
    await loadDiffForSelectionQuiet(newSelection);
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

  async function loadDiffForSelectionQuiet(
    selection: ChangeSelectionEntry[],
    path = selectedPath,
  ) {
    const seen = new Set<string>();
    const entries = selection.filter((entry) => {
      if (seen.has(entry.file.path)) return false;
      seen.add(entry.file.path);
      return true;
    });

    const requestId = ++loadDiffRequestRef.current;
    setDiffSelection(selection);

    if (!path || entries.length === 0) {
      if (requestId !== loadDiffRequestRef.current) return;
      setDiff(emptyDiff);
      setDiffBundles([]);
      return;
    }

    try {
      const parts = await Promise.all(
        entries.map((entry) =>
          invoke<{ staged: string; unstaged: string }>("file_diff_parts", {
            path,
            filePath: entry.file.path,
          }),
        ),
      );
      if (requestId !== loadDiffRequestRef.current) return;
      const bundles = parts.flatMap((part) => buildDiffBundles(part.staged, part.unstaged));
      setDiffBundles(bundles);
      const combined = parts
        .flatMap((part) => [part.staged, part.unstaged])
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\n\n");
      if (entries.length === 1) {
        setDiff(combined || "This file has no tracked diff.");
      } else {
        setDiff(combined || "No diff available for selected files.");
      }
    } catch (err) {
      if (requestId !== loadDiffRequestRef.current) return;
      setError(String(err));
    }
  }

  function beginSelectionPreserve() {
    selectionPreserveRef.current += 1;
  }

  function endSelectionPreserve() {
    selectionPreserveRef.current = Math.max(0, selectionPreserveRef.current - 1);
  }

  async function reconcileWorkingSelection(affectedPaths: string[]) {
    const changes = await refreshChangesQuiet();
    if (!changes) return;

    const pathsToKeep =
      diffSelection.length > 0
        ? [...new Set(diffSelection.map((entry) => entry.file.path))]
        : focus?.kind === "file"
          ? [focus.file.path]
          : [...new Set(affectedPaths)];

    const newSelection: ChangeSelectionEntry[] = [];
    for (const path of pathsToKeep) {
      const prior = diffSelection.find((entry) => entry.file.path === path);
      const priorSection =
        prior?.section ??
        (focus?.kind === "file" && focus.file.path === path ? focus.section : undefined);
      const unstaged = changes.find((file) => file.path === path && isUnstaged(file));
      const staged = changes.find((file) => file.path === path && isStaged(file));

      if (priorSection === "staged" && staged) {
        newSelection.push({ file: staged, section: "staged" });
      } else if (priorSection === "unstaged" && unstaged) {
        newSelection.push({ file: unstaged, section: "unstaged" });
      } else if (unstaged) {
        newSelection.push({ file: unstaged, section: "unstaged" });
      } else if (staged) {
        newSelection.push({ file: staged, section: "staged" });
      }
    }

    if (newSelection.length === 0) {
      setFocus(null);
      setDiff(emptyDiff);
      setDiffSelection([]);
      return;
    }

    const primaryPath =
      affectedPaths.find((path) => pathsToKeep.includes(path)) ?? pathsToKeep[0];
    const primary =
      newSelection.find((entry) => entry.file.path === primaryPath) ??
      newSelection[newSelection.length - 1];

    setFocus({ kind: "file", file: primary.file, section: primary.section });
    setDiffSelection(newSelection);
    await loadDiffForSelectionQuiet(newSelection);
  }

  async function stageHunk(filePath: string, patch: string) {
    if (!selectedPath) return;
    beginSelectionPreserve();
    try {
      const result = await run(() =>
        invoke<ActionResult>("stage_hunk", { path: selectedPath, filePath, patch }),
      );
      if (!result) return;
      await reconcileWorkingSelection([filePath]);
    } finally {
      endSelectionPreserve();
    }
  }

  async function unstageHunk(filePath: string, patch: string) {
    if (!selectedPath) return;
    beginSelectionPreserve();
    try {
      const result = await run(() =>
        invoke<ActionResult>("unstage_hunk", { path: selectedPath, filePath, patch }),
      );
      if (!result) return;
      await reconcileWorkingSelection([filePath]);
    } finally {
      endSelectionPreserve();
    }
  }

  async function discardHunk(filePath: string, patch: string) {
    if (!selectedPath) return;
    beginSelectionPreserve();
    try {
      const result = await run(() =>
        invoke<ActionResult>("discard_hunk", { path: selectedPath, filePath, patch }),
      );
      if (!result) return;
      await reconcileWorkingSelection([filePath]);
    } finally {
      endSelectionPreserve();
    }
  }

  async function inspectFile(file: FileChange, section: ChangeSection) {
    setViewingCommit(null);
    setCommitFiles([]);
    setFocus({ kind: "file", file, section });
  }

  async function inspectFileQuiet(file: FileChange, section: ChangeSection, path = selectedPath) {
    setViewingCommit(null);
    setCommitFiles([]);
    setFocus({ kind: "file", file, section });
    await loadDiffForSelectionQuiet([{ file, section }], path);
  }

  const handleChangesSelectionChange = useCallback(
    (selection: ChangeSelectionEntry[]) => {
      if (viewingCommit) return;
      if (selection.length === 0 && selectionPreserveRef.current > 0) return;
      const nextKey = selectionPathsKey(selection);
      const currentKey = selectionPathsKey(diffSelection);
      if (nextKey === currentKey) return;
      void loadDiffForSelectionQuiet(selection);
    },
    [selectedPath, viewingCommit, diffSelection],
  );

  async function captureReturnTarget(path = selectedPath): Promise<{
    returnBranch: string;
    returnHead?: string;
  } | null> {
    if (!path || !snapshot) return null;
    const isDetached = snapshot.branch.includes("detached");
    if (!isDetached) {
      return { returnBranch: snapshot.branch };
    }
    try {
      const head = await invoke<string>("rev_parse_head", { path });
      return { returnBranch: snapshot.branch, returnHead: head };
    } catch (err) {
      setError(String(err));
      return null;
    }
  }

  async function executeVisitCheckout(commit: CommitEntry, stashed: boolean) {
    if (!selectedPath || !snapshot) return false;

    const returnTarget = await captureReturnTarget();
    if (!returnTarget) return false;

    const result = await run(() =>
      invoke<ActionResult>("checkout_branch", { path: selectedPath, branch: commit.hash }),
    );
    if (!result) return false;

    setMessage(result.message);
    setVisitSession({
      returnBranch: returnTarget.returnBranch,
      returnHead: returnTarget.returnHead,
      visitedCommit: commit,
      stashed,
    });
    setViewingCommit(null);
    setViewingCommitMessage("");
    setCommitFiles([]);
    setFocus(null);
    setDiff(emptyDiff);
    setVisitCommitDialogOpen(false);
    setVisitCommitTarget(null);
    await refreshRepo();
    return true;
  }

  function requestVisitCommit(commit?: CommitEntry) {
    const target = commit ?? viewingCommit;
    if (!target || !selectedPath || !snapshot || visitSession) return;

    if (!snapshot.isClean) {
      setVisitCommitTarget(target);
      setVisitCommitDialogOpen(true);
      return;
    }

    if (
      !window.confirm(
        `Visit ${target.shortHash}? Your working tree will match that point in history.`,
      )
    ) {
      return;
    }

    void executeVisitCheckout(target, false);
  }

  async function handleVisitCommitDialogAction(action: VisitCommitDialogAction) {
    const commit = visitCommitTarget;
    if (!commit || !selectedPath || !snapshot) {
      setVisitCommitDialogOpen(false);
      setVisitCommitTarget(null);
      return;
    }

    if (action === "cancel" || action === "keep") {
      setVisitCommitDialogOpen(false);
      setVisitCommitTarget(null);
      return;
    }

    if (action === "discard") {
      const untracked = snapshot.changes.some((change) => change.status.includes("?"));
      const resetResult = await run(() =>
        invoke<ActionResult>("reset_working_tree", {
          path: selectedPath,
          includeUntracked: untracked,
        }),
      );
      if (!resetResult) return;
      setMessage(resetResult.message);
      await executeVisitCheckout(commit, false);
      return;
    }

    const stashResult = await run(() =>
      invoke<ActionResult>("stash_push", {
        path: selectedPath,
        message: `gitty-visit-${commit.shortHash}`,
      }),
    );
    if (!stashResult) return;
    setMessage(stashResult.message);
    await executeVisitCheckout(commit, true);
  }

  async function returnFromVisit() {
    if (!visitSession || !selectedPath) return;

    const { returnBranch, returnHead, stashed } = visitSession;
    const checkoutTarget = returnBranch.includes("detached")
      ? returnHead ?? visitSession.visitedCommit.hash
      : returnBranch;

    if (!checkoutTarget) {
      setError("Could not determine where to return from time travel.");
      return;
    }

    const checkoutResult = await run(() =>
      invoke<ActionResult>("checkout_branch", { path: selectedPath, branch: checkoutTarget }),
    );
    if (!checkoutResult) return;

    if (stashed) {
      const popResult = await run(() => invoke<ActionResult>("stash_pop", { path: selectedPath }));
      if (!popResult) return;
      setMessage(popResult.message);
    } else {
      setMessage(checkoutResult.message);
    }

    setVisitSession(null);
    await selectWorkingTree({ refresh: true });
  }

  async function checkoutBranch(branch: string) {
    if (!selectedPath || !branch) return;
    if (visitSession) {
      setError("Return to latest before switching branches.");
      return;
    }

    // Picking a remote-tracking branch (e.g. "github/main") with a plain
    // checkout detaches HEAD. If a local branch already tracks it — or shares
    // its leaf name — switch to that local branch instead so the user stays on
    // a real branch they can commit and push from.
    const branches = snapshot?.branches ?? [];
    const picked = branches.find((b) => b.name === branch);
    if (picked?.isRemote) {
      const leaf = branch.split("/").slice(1).join("/");
      const localEquivalent =
        branches.find((b) => !b.isRemote && b.upstream === branch) ??
        branches.find((b) => !b.isRemote && b.name === leaf);
      if (localEquivalent) branch = localEquivalent.name;
    }

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

  async function createBranch(name: string) {
    if (!selectedPath || !name.trim()) return;
    if (visitSession) {
      setError("Return to latest before starting a branch.");
      return;
    }
    const result = await run(() =>
      invoke<ActionResult>("create_branch", { path: selectedPath, name }),
    );
    if (!result) return;
    setBranchCreateOpen(false);
    setMessage(result.message);
    setViewingCommit(null);
    setCommitFiles([]);
    setFocus(null);
    setDiff(emptyDiff);
    await refreshRepo();
  }

  async function resumeBranch() {
    if (visitSession) {
      setError("Return to latest before resuming the branch.");
      return;
    }
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

  // ── Merge mode ──────────────────────────────────────────────────────────

  const mergeAnalysisKeyRef = useRef("");

  async function fetchMergeAnalysis(source: string, target: string) {
    return invoke<MergeAnalysis>("merge_analysis", {
      path: selectedPath,
      source,
      target,
    });
  }

  async function loadMergeAnalysis(session: MergeSession) {
    setMergeAnalysisLoading(true);
    try {
      const result = await fetchMergeAnalysis(session.source, session.target);
      setMergeAnalysis(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setMergeAnalysisLoading(false);
    }
  }

  function openMerge(pair?: { source: string; target: string } | null) {
    if (!selectedPath || !snapshot) return;
    if (visitSession) {
      setError("Return to latest before merging.");
      return;
    }
    const { source, target } = pair ?? mergePair ?? {};
    if (!source || !target || source === target || source.includes("detached")) return;

    const current = snapshot.branch;
    const session: MergeSession = {
      source,
      target,
      // "ship" = current branch is the source; "update" = current is the target
      // (the partner is being merged into us). Drives the panel's swap wording.
      direction: current === target ? "update" : "ship",
      phase: "preview",
      returnBranch: current,
    };
    setViewingCommit(null);
    setCommitFiles([]);
    setFocus(null);
    setDiff(emptyDiff);
    setViewMode("working");
    setMergePushed(false);
    setConflictFiles([]);
    setResolvedFiles([]);
    setSelectedConflict(null);
    setConflictSides(null);
    setMergeSession(session);
    // Reuse cached analysis when it already matches this pair.
    if (mergeAnalysis && mergeAnalysis.source === source && mergeAnalysis.target === target) {
      // keep it
    } else {
      setMergeAnalysis(null);
    }
    void loadMergeAnalysis(session);
  }

  function closeMerge() {
    setMergeSession(null);
    setMergeAnalysis(null);
    mergeAnalysisKeyRef.current = "";
    setConflictFiles([]);
    setResolvedFiles([]);
    setSelectedConflict(null);
    setConflictSides(null);
    setMergePushed(false);
  }

  function swapMergeDirection() {
    if (!mergeSession) return;
    openMerge({ source: mergeSession.target, target: mergeSession.source });
  }

  // A clean merge needs no further input — close the merge UI and drop straight
  // back to the working tree. Git already left us on the target branch, so the
  // merge result is in view and the top-bar Push button surfaces it normally.
  async function concludeMerge() {
    closeMerge();
    const snap = await refreshRepo();
    if (snap) await selectWorkingTree({ snapshot: snap });
  }

  async function runMerge() {
    if (!selectedPath || !mergeSession || mergeRunning) return;
    if (mergeAnalysis && !mergeAnalysis.workingTreeClean) {
      setError("Commit or stash your changes before merging.");
      return;
    }
    setMergeRunning(true);
    setMergeSession((prev) => (prev ? { ...prev, phase: "merging" } : prev));
    setError("");
    setMessage("");
    try {
      const outcome = await invoke<MergeOutcome>("merge_execute", {
        path: selectedPath,
        source: mergeSession.source,
        target: mergeSession.target,
        updateFirst: (mergeAnalysis?.targetBehind ?? 0) > 0,
      });
      if (outcome.status === "conflicts") {
        await refreshRepoQuiet(selectedPath);
        setConflictFiles(outcome.conflictFiles);
        setResolvedFiles([]);
        setSelectedConflict(outcome.conflictFiles[0] ?? null);
        setMergeSession((prev) => (prev ? { ...prev, phase: "conflicts" } : prev));
      } else {
        setMessage(outcome.message);
        await concludeMerge();
      }
    } catch (err) {
      setError(String(err));
      setMergeSession((prev) => (prev ? { ...prev, phase: "preview" } : prev));
    } finally {
      setMergeRunning(false);
    }
  }

  async function refreshMergeStatus() {
    if (!selectedPath) return;
    try {
      const status = await invoke<MergeStatus>("merge_status", { path: selectedPath });
      setConflictFiles(status.conflictFiles);
      setResolvedFiles(status.resolvedFiles);
      setSelectedConflict((prev) =>
        prev && status.conflictFiles.includes(prev)
          ? prev
          : status.conflictFiles[0] ?? null,
      );
    } catch (err) {
      setError(String(err));
    }
  }

  async function resolveConflictFile(file: string, side: "ours" | "theirs") {
    if (!selectedPath) return;
    const result = await run(() =>
      invoke<ActionResult>("resolve_conflict", { path: selectedPath, file, side }),
    );
    if (!result) return;
    await refreshMergeStatus();
    await refreshChangesQuiet(selectedPath);
  }

  async function resolveConflictManual(content: string) {
    if (!selectedPath || !selectedConflict) return;
    const result = await run(() =>
      invoke<ActionResult>("resolve_conflict_manual", {
        path: selectedPath,
        file: selectedConflict,
        content,
      }),
    );
    if (!result) return;
    await refreshMergeStatus();
    await refreshChangesQuiet(selectedPath);
  }

  async function completeMerge() {
    if (!selectedPath) return;
    const result = await run(() =>
      invoke<ActionResult>("complete_merge", { path: selectedPath, message: null }),
    );
    if (!result) return;
    setMessage(result.message);
    await concludeMerge();
  }

  async function abortMerge() {
    if (!selectedPath) return;
    const returnBranch = mergeSession?.returnBranch ?? null;
    const result = await run(() =>
      invoke<ActionResult>("abort_merge", { path: selectedPath, returnBranch }),
    );
    closeMerge();
    if (result) setMessage(result.message);
    const snap = await refreshRepo();
    if (snap) await selectWorkingTree({ snapshot: snap });
  }

  async function mergePush() {
    const ok = await push(false);
    if (ok) setMergePushed(true);
  }

  async function finishMerge() {
    const returnBranch = mergeSession?.returnBranch;
    closeMerge();
    if (returnBranch && snapshot && snapshot.branch !== returnBranch) {
      await run(() =>
        invoke<ActionResult>("checkout_branch", {
          path: selectedPath,
          branch: returnBranch,
        }),
      );
    }
    const snap = await refreshRepo();
    if (snap) await selectWorkingTree({ snapshot: snap });
  }

  function showMergeCommands() {
    if (!mergeSession) return;
    const { source, target } = mergeSession;
    const lines = [
      `git switch ${target}`,
      (mergeAnalysis?.targetBehind ?? 0) > 0 ? `git pull --ff-only` : null,
      `git merge ${source}`,
      `git push`,
    ].filter(Boolean);
    setMessage(`Equivalent commands:\n${lines.join("\n")}`);
  }

  async function loadConflictSides(file: string) {
    if (!selectedPath) return;
    setConflictSidesLoading(true);
    try {
      const sides = await invoke<ConflictSides>("conflict_sides", {
        path: selectedPath,
        file,
      });
      setConflictSides(sides);
    } catch (err) {
      setError(String(err));
    } finally {
      setConflictSidesLoading(false);
    }
  }

  useEffect(() => {
    if (mergeSession?.phase === "conflicts" && selectedConflict) {
      void loadConflictSides(selectedConflict);
    } else {
      setConflictSides(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConflict, mergeSession?.phase]);

  useEffect(() => {
    if (mergeSession) return;
    if (viewMode !== "working") return;
    if (!selectedPath || !snapshot || !mergePair) return;
    const headHash = snapshot.commits[0]?.hash ?? "";
    const key = `${selectedPath}|${mergePair.source}|${mergePair.target}|${headHash}`;
    if (mergeAnalysisKeyRef.current === key) return;
    mergeAnalysisKeyRef.current = key;
    const { source, target } = mergePair;
    let cancelled = false;
    void fetchMergeAnalysis(source, target)
      .then((res) => {
        if (!cancelled) setMergeAnalysis(res);
      })
      .catch(() => {
        mergeAnalysisKeyRef.current = "";
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath, mergePair?.source, mergePair?.target, viewMode, snapshot?.commits, mergeSession]);

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

    const toggledPaths = new Set(files);
    const selectionAlreadyUpdated = anchor?.remainingSelection !== undefined;
    if (selectionAlreadyUpdated) {
      focusAfterToggle(toggledPaths, anchor.remainingSelection ?? []);
    }

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
      await resolveSelectionAfterToggle(files, changes, anchor, selectionAlreadyUpdated);
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

    const toggledPaths = new Set(files);
    const selectionAlreadyUpdated = anchor?.remainingSelection !== undefined;
    if (selectionAlreadyUpdated) {
      focusAfterToggle(toggledPaths, anchor.remainingSelection ?? []);
    }

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
      await resolveSelectionAfterToggle(files, changes, anchor, selectionAlreadyUpdated);
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
    setChangeSummaryScope("staged");
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
    await summarizeChanges("staged", false);
  }

  async function resummarizeStagedChanges() {
    summaryHiddenUntilNewRef.current = false;
    await summarizeChanges("staged", true);
  }

  async function summarizeAllChanges() {
    summaryHiddenUntilNewRef.current = false;
    await summarizeChanges("all", true);
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

  // ⌘↵ with staged changes but no message/summary yet: start preparing the AI
  // commit message so a second ⌘↵ can accept it. Triggered explicitly by the
  // shortcut, so it runs regardless of the auto-summarize-on-focus setting.
  function prepareCommitSummary() {
    if (!snapshot || snapshot.changes.length === 0) return;
    if (nvidiaApiKeyConfigured) {
      summaryHiddenUntilNewRef.current = false;
      void summarizeChanges("staged", false);
    } else if (!summaryHiddenUntilNewRef.current) {
      setChangeSummaryVisible(true);
    }
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

  async function discardSelectedFiles() {
    if (!selectedPath || discardFilesTarget.length === 0) return;
    const discardedPaths = [...discardFilesTarget];
    const result = await run(() =>
      invoke<ActionResult>("discard_files", {
        path: selectedPath,
        files: discardedPaths,
      }),
    );
    if (!result) return;
    setDiscardFilesOpen(false);
    setDiscardFilesTarget([]);
    if (
      focus?.kind === "file" &&
      discardedPaths.includes(focus.file.path)
    ) {
      setFocus(null);
      setDiff(emptyDiff);
    }
    setChangeSummaryVisible(false);
    resetSummaryCache();
    setMessage([result.message, result.output].filter(Boolean).join("\n"));
    await refreshRepo();
  }

  function openDiscardFilesDialog(paths: string[]) {
    const uniquePaths = [...new Set(paths)];
    if (uniquePaths.length === 0) return;
    setDiscardFilesTarget(uniquePaths);
    setDiscardFilesOpen(true);
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
  const hasMixedChanges = stagedCount > 0 && stagedCount < changeCount;
  const showResummarizeStaged =
    !!changeSummary && hasMixedChanges && changeSummaryScope === "all";
  const showSummarizeAllChanges =
    !!changeSummary && hasMixedChanges && changeSummaryScope === "staged" && !allSummaryAvailable;
  const canShowAllChangesSummary = changeSummaryScope === "staged" && allSummaryAvailable;

  useEffect(() => {
    if (!snapshot) return;
    const pathsKey = changePathsKey(snapshot.changes);
    const stagedKey = stagedPathsKey(snapshot.changes);
    const cache = summaryCacheRef.current;

    if (cache.all && cache.all.pathsKey !== pathsKey) {
      summaryCacheRef.current = { ...cache, all: null };
      if (cache.displayScope === "all") {
        if (cache.staged && cache.staged.pathsKey === stagedKey) {
          setChangeSummary(cache.staged.summary.summary);
          setChangeSummaryScope("staged");
          summaryCacheRef.current = { ...summaryCacheRef.current, displayScope: "staged" };
        } else {
          setChangeSummary(null);
          setChangeSummaryScope("staged");
        }
      }
    }

    if (cache.staged && cache.staged.pathsKey !== stagedKey) {
      summaryHiddenUntilNewRef.current = false;
      summaryCacheRef.current = {
        ...summaryCacheRef.current,
        staged: null,
      };
      if (summaryCacheRef.current.displayScope === "staged") {
        setChangeSummary(null);
        setChangeSummaryScope("staged");
      }
    }
  }, [snapshot?.changes, snapshot?.repo.path]);
  const hasRemotes = (snapshot?.remotes.length ?? 0) > 0;
  const showCommitSection = workingTreeActive && !mergeSession;
  const showResetSection = !!visitSession;

  // Merge-strip chips reflect the resolved pair. Only meaningful when the cached
  // analysis matches that pair. "ahead" = commits the source brings; "behind" =
  // commits the target has that the source lacks.
  const pairAnalysis =
    mergeAnalysis &&
    mergePair &&
    mergeAnalysis.source === mergePair.source &&
    mergeAnalysis.target === mergePair.target
      ? mergeAnalysis
      : null;
  const aheadOfBase = pairAnalysis ? pairAnalysis.commits.length : null;
  const baseBehind = pairAnalysis ? pairAnalysis.sourceBehind : null;
  const mergeConflictState: "clean" | "conflicts" | "unknown" | "checking" =
    mergeSession?.phase === "conflicts"
      ? "conflicts"
      : mergeAnalysisLoading && !pairAnalysis
        ? "checking"
        : pairAnalysis
          ? pairAnalysis.alreadyUpToDate
            ? "unknown"
            : !pairAnalysis.conflictsKnown
              ? "unknown"
              : pairAnalysis.hasConflicts
                ? "conflicts"
                : "clean"
          : "unknown";

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
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "b") return;
      if (shouldIgnoreKeyboardNavigation(event)) return;
      event.preventDefault();
      toggleSidebar();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "m") return;
      if (shouldIgnoreKeyboardNavigation(event)) return;
      if (!mergePair) return;
      event.preventDefault();
      if (mergeSession) {
        if (mergeSession.phase === "preview") closeMerge();
      } else {
        openMerge(mergePair);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergePair?.source, mergePair?.target, mergeSession]);

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
    <main className={`app-shell${sidebarVisible ? "" : " sidebar-hidden"}`}>
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
        onHide={toggleSidebar}
      />

      <section className={`main-area${repoSwitching ? " repo-switching" : ""}`}>
        {!sidebarVisible && !displaySnapshot && !repoSwitching ? (
          <button
            type="button"
            className="sidebar-restore-btn"
            title="Show repositories"
            aria-label="Show repositories"
            onClick={toggleSidebar}
          >
            <PanelLeft size={15} />
          </button>
        ) : null}
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
              sidebarVisible={sidebarVisible}
              onToggleSidebar={toggleSidebar}
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
              branchEntries={displaySnapshot.branches}
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
              sidebarVisible={sidebarVisible}
              onToggleSidebar={toggleSidebar}
              onRepoChange={(path) => void selectRepo(path)}
              onBranchChange={(branch) => void checkoutBranch(branch)}
              onMergeIn={(name) =>
                openMerge({ source: name, target: displaySnapshot.branch })
              }
              viewingCommit={viewingCommit}
              visitSession={visitSession}
              onSelectCommit={(commit) => void inspectCommit(commit)}
              onVisitCommit={() => requestVisitCommit()}
              onReturnFromVisit={() => void returnFromVisit()}
              onResumeBranch={() => void resumeBranch()}
              onToggleView={() => {
                if (viewMode === "history" && !viewingCommit) {
                  setCommitFiles([]);
                  setFocus(null);
                  setDiff(emptyDiff);
                }
                setViewMode((mode) => (mode === "working" ? "history" : "working"));
              }}
              onReturnToWorkingTree={() => void selectWorkingTree()}
              onRefresh={() => void refreshRepo()}
              onPush={() => push(false)}
              onForcePush={() => push(true)}
              onSetupRemote={() => openRepoSettings()}
              mergeStripAvailable={mergeStripAvailable}
              mergeIncoming={mergeIncoming}
              mergeSource={mergePair?.source ?? null}
              mergeTargetName={mergePair?.target ?? null}
              mergePartner={mergePartner}
              mergeCandidates={mergeCandidates}
              onMergePartnerChange={(name) => {
                setMergeTarget(name);
                if (mergeSession && mergeSession.phase === "preview") {
                  closeMerge();
                }
              }}
              onClearMerge={() => {
                setMergeTarget(null);
                if (mergeSession && mergeSession.phase === "preview") {
                  closeMerge();
                }
              }}
              mergeActive={!!mergeSession}
              aheadOfBase={aheadOfBase}
              baseBehind={baseBehind}
              mergeConflictState={mergeConflictState}
              onOpenMerge={() => openMerge()}
              onExitMerge={() => {
                if (mergeSession?.phase === "conflicts") {
                  setError("Resolve or abort the merge before leaving.");
                  return;
                }
                if (mergeSession?.phase === "done") {
                  void finishMerge();
                } else {
                  closeMerge();
                }
              }}
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
                  contextLanes={displaySnapshot.timelineContext ?? []}
                  onUpdateFromBase={(lane) =>
                    openMerge({ source: lane.refName, target: displaySnapshot.branch })
                  }
                  onInteract={() => setNavZone("timeline")}
                  onSelect={(commit) => void inspectCommit(commit)}
                  onSelectWorkingTree={() => void selectWorkingTree()}
                  onVisitCommit={(commit) => requestVisitCommit(commit)}
                  onCreateTag={(commit) => openCreateTagDialog(commit)}
                  onDeleteTag={(commit, name) => openDeleteTagDialog(commit, name)}
                  mergePreview={
                    mergeSession
                      ? {
                          target: mergeSession.target,
                          source: mergeSession.source,
                          merged: mergeSession.phase === "done",
                          conflicts: mergeSession.phase === "conflicts",
                        }
                      : null
                  }
                />

                {mergeSession && mergeSession.phase === "conflicts" ? (
                  <div className="merge-conflict-grid">
                    <div className="conflict-file-list">
                      <header className="conflict-list-head">
                        <span>Conflicted</span>
                        <em>{conflictFiles.length}</em>
                      </header>
                      {conflictFiles.length === 0 ? (
                        <p className="conflict-list-empty">
                          All conflicts resolved. Complete the merge.
                        </p>
                      ) : (
                        <ul>
                          {conflictFiles.map((file) => (
                            <li key={file}>
                              <button
                                type="button"
                                className={file === selectedConflict ? "active" : ""}
                                onClick={() => setSelectedConflict(file)}
                              >
                                <span className="conflict-file-row-name">
                                  {file.split("/").pop()}
                                </span>
                                <span className="conflict-file-row-path">{file}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {resolvedFiles.length > 0 ? (
                        <>
                          <header className="conflict-list-head resolved">
                            <span>Resolved</span>
                            <em>{resolvedFiles.length}</em>
                          </header>
                          <ul>
                            {resolvedFiles.map((file) => (
                              <li key={file} className="resolved-row">
                                <span className="conflict-file-row-name">
                                  {file.split("/").pop()}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </div>

                    <ConflictResolver
                      file={selectedConflict}
                      sides={conflictSides}
                      loading={conflictSidesLoading}
                      oursLabel={mergeSession.target}
                      theirsLabel={mergeSession.source}
                      resolved={
                        !!selectedConflict && resolvedFiles.includes(selectedConflict)
                      }
                      onUseOurs={() =>
                        selectedConflict &&
                        void resolveConflictFile(selectedConflict, "ours")
                      }
                      onUseTheirs={() =>
                        selectedConflict &&
                        void resolveConflictFile(selectedConflict, "theirs")
                      }
                      onSaveManual={(content) => void resolveConflictManual(content)}
                    />

                    <MergePanel
                      analysis={mergeAnalysis}
                      source={mergeSession.source}
                      target={mergeSession.target}
                      currentBranch={mergeSession.returnBranch}
                      phase={mergeSession.phase}
                      loading={loading}
                      running={mergeRunning}
                      hasRemotes={hasRemotes}
                      conflictCount={conflictFiles.length}
                      pushed={mergePushed}
                      onMerge={() => void runMerge()}
                      onCancel={closeMerge}
                      onSwapDirection={swapMergeDirection}
                      onCompleteMerge={() => void completeMerge()}
                      onAbort={() => void abortMerge()}
                      onPush={() => void mergePush()}
                      onShowCommands={showMergeCommands}
                      onBackToWorkingTree={() => void finishMerge()}
                    />
                  </div>
                ) : showGittyEmptyState && !mergeSession ? (
                  <GittyEmptyState projectName={displaySnapshot.repo.name} />
                ) : (
                  <div className="workspace-grid">
                    <SplitPane
                      className="workspace-split"
                      orientation="horizontal"
                      split={workspaceSplit}
                      onSplitChange={setWorkspaceSplit}
                      showLayoutToggle={false}
                      minSplit={0.15}
                      maxSplit={0.65}
                      primary={
                        <ChangesList
                          ref={changesListRef}
                          changes={viewingCommit ? commitFiles : displaySnapshot.changes}
                          repoPath={selectedPath}
                          variant={viewingCommit ? "commit" : "working"}
                          selectedKey={selectedFileKey}
                          managedSelection={workingTreeActive ? diffSelection : undefined}
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
                          onSelectionChange={
                            workingTreeActive ? handleChangesSelectionChange : undefined
                          }
                          onStage={(files, anchor) => void stageFiles(files, anchor)}
                          onUnstage={(files, anchor) => void unstageFiles(files, anchor)}
                          onResetAll={
                            workingTreeActive && displaySnapshot.changes.length > 0
                              ? () => setResetAllOpen(true)
                              : undefined
                          }
                          onRequestDiscard={
                            workingTreeActive ? (paths) => openDiscardFilesDialog(paths) : undefined
                          }
                          disabled={loading}
                        />
                      }
                      secondary={
                        <DiffViewer
                          raw={diff}
                          diffBundles={workingTreeActive ? diffBundles : undefined}
                          file={selectedFile}
                          selection={workingTreeActive ? diffSelection : []}
                          repoPath={selectedPath}
                          section={focus?.kind === "file" ? focus.section : undefined}
                          commit={
                            focus?.kind === "commit" ? focus.commit.hash : viewingCommit?.hash
                          }
                          showWorkingTreeBadges={!viewingCommit}
                          emptyMessage={emptyDiff}
                          disabled={loading}
                          onUnstage={(path) => void unstageFiles([path])}
                          onStageHunk={(filePath, patch) => void stageHunk(filePath, patch)}
                          onUnstageHunk={(filePath, patch) => void unstageHunk(filePath, patch)}
                          onDiscardHunk={(filePath, patch) => void discardHunk(filePath, patch)}
                        />
                      }
                    />

                    {mergeSession ? (
                      <MergePanel
                        analysis={mergeAnalysis}
                        source={mergeSession.source}
                        target={mergeSession.target}
                        currentBranch={mergeSession.returnBranch}
                        phase={mergeSession.phase}
                        loading={mergeAnalysisLoading}
                        running={mergeRunning}
                        hasRemotes={hasRemotes}
                        conflictCount={conflictFiles.length}
                        pushed={mergePushed}
                        onMerge={() => void runMerge()}
                        onCancel={closeMerge}
                        onSwapDirection={swapMergeDirection}
                        onCompleteMerge={() => void completeMerge()}
                        onAbort={() => void abortMerge()}
                        onPush={() => void mergePush()}
                        onShowCommands={showMergeCommands}
                        onBackToWorkingTree={() => void finishMerge()}
                      />
                    ) : (
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
                      showStartBranch={showCommitSection && onIntegrationBranch && changeCount > 0}
                      nvidiaApiKey={nvidiaApiKey}
                      nvidiaApiKeyConfigured={nvidiaApiKeyConfigured}
                      changeSummary={changeSummary}
                      changeSummaryLoading={changeSummaryLoading}
                      changeSummaryError={changeSummaryError}
                      changeSummaryVisible={changeSummaryVisible}
                      changeSummaryScope={changeSummaryScope}
                      showResummarizeStaged={showResummarizeStaged}
                      showSummarizeAllChanges={showSummarizeAllChanges}
                      showAllChangesSummary={canShowAllChangesSummary}
                      onMessageChange={setCommitMessage}
                      onMessageFocus={handleCommitMessageFocus}
                      onUseSummary={useChangeSummary}
                      onUseSummaryAndCommit={useChangeSummaryAndCommit}
                      onGenerateSummary={prepareCommitSummary}
                      onDismissSummary={dismissChangeSummary}
                      onResummarizeStaged={() => void resummarizeStagedChanges()}
                      onSummarizeAllChanges={() => void summarizeAllChanges()}
                      onShowAllChangesSummary={restoreAllChangesSummary}
                      onNvidiaApiKeyChange={setNvidiaApiKey}
                      onSaveNvidiaApiKey={() => void saveNvidiaApiKeyFromPanel()}
                      onAmendChange={(checked) => void handleAmendChange(checked)}
                      onPushOnCommitChange={(checked) => void handlePushOnCommitChange(checked)}
                      onResetModeChange={setResetMode}
                      onCommit={() => void commit()}
                      onReset={() => void reset()}
                      onSetupRemote={() => openRepoSettings()}
                      onStartBranch={() => setBranchCreateOpen(true)}
                      disabled={loading}
                    />
                    )}
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
                      currentBranch={displaySnapshot.branch}
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
                      onSelect={(commit) => void inspectCommit(commit)}
                      onVisitCommit={(commit) => requestVisitCommit(commit)}
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
          <VisitCommitDialog
            open={visitCommitDialogOpen}
            commit={visitCommitTarget}
            changes={snapshot.changes}
            loading={loading}
            onAction={(action) => void handleVisitCommitDialogAction(action)}
          />
          <ResetAllConfirmDialog
            open={resetAllOpen}
            repoName={snapshot.repo.name}
            changes={snapshot.changes}
            loading={loading}
            onConfirm={(includeUntracked) => void resetAllWorkingTree(includeUntracked)}
            onCancel={() => setResetAllOpen(false)}
          />
          <DiscardFilesConfirmDialog
            open={discardFilesOpen}
            paths={discardFilesTarget}
            changes={snapshot.changes}
            loading={loading}
            onConfirm={() => void discardSelectedFiles()}
            onCancel={() => {
              setDiscardFilesOpen(false);
              setDiscardFilesTarget([]);
            }}
          />
          <BranchCreateDialog
            open={branchCreateOpen}
            fromBranch={snapshot.branch}
            changes={snapshot.changes ?? []}
            loading={loading}
            onConfirm={(name) => void createBranch(name)}
            onCancel={() => setBranchCreateOpen(false)}
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
