import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  RotateCcw,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ActionExecutionState, RepoAction } from "../types";

type ActivityFeedProps = {
  message: string;
  error: string;
  gitBusy: boolean;
  sessions: ActionExecutionState[];
  onOpenExecution: (session: ActionExecutionState) => void;
  onRerun: (action: RepoAction) => void;
  onClearExecution: (session: ActionExecutionState) => void;
  onDismissExecution: (session: ActionExecutionState) => void;
};

type ActivityTab = "git" | string;
const BOTTOM_TOLERANCE_PX = 12;

export function ActivityFeed({
  message,
  error,
  gitBusy,
  sessions,
  onOpenExecution,
  onRerun,
  onClearExecution,
  onDismissExecution,
}: ActivityFeedProps) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<ActivityTab>(() => sessions[sessions.length - 1]?.runId ?? "git");
  const gitScrollRef = useRef<HTMLDivElement>(null);
  const terminalScrollRef = useRef<HTMLDivElement>(null);
  const gitFollowLatestRef = useRef(true);
  const terminalFollowLatestRef = useRef(new Map<string, boolean>());

  const activeSession = sessions.find((session) => session.runId === activeTab) ?? null;
  const latestSession = sessions[sessions.length - 1] ?? null;
  const latestLogId = activeSession?.logs[activeSession.logs.length - 1]?.id;

  useEffect(() => {
    if (!latestSession) return;
    if (!gitBusy) setActiveTab(latestSession.runId);
    terminalFollowLatestRef.current.set(latestSession.runId, true);
  }, [latestSession?.startTime]);

  useEffect(() => {
    if (gitBusy) setActiveTab("git");
  }, [gitBusy]);

  useEffect(() => {
    if (activeSession && !terminalFollowLatestRef.current.has(activeSession.runId)) {
      terminalFollowLatestRef.current.set(activeSession.runId, true);
    }
  }, [activeSession?.runId]);

  useEffect(() => {
    const feed = gitScrollRef.current;
    if (activeTab !== "git" || !feed || !gitFollowLatestRef.current) return;
    feed.scrollTop = feed.scrollHeight;
  }, [activeTab, message, error]);

  useEffect(() => {
    const feed = terminalScrollRef.current;
    if (!activeSession || !feed || terminalFollowLatestRef.current.get(activeSession.runId) === false) return;
    feed.scrollTop = feed.scrollHeight;
  }, [activeSession?.runId, activeSession?.status, latestLogId]);

  useEffect(() => {
    if (activeTab !== "git" && !activeSession) setActiveTab("git");
  }, [activeSession, activeTab]);

  function handleScroll(kind: "git" | "terminal") {
    const feed = kind === "git" ? gitScrollRef.current : terminalScrollRef.current;
    if (!feed) return;
    const remaining = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
    if (kind === "git") gitFollowLatestRef.current = remaining <= BOTTOM_TOLERANCE_PX;
    else if (activeSession) terminalFollowLatestRef.current.set(activeSession.runId, remaining <= BOTTOM_TOLERANCE_PX);
  }

  function handleCopy(session: ActionExecutionState) {
    void navigator.clipboard.writeText(session.logs.map((log) => log.line).join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <footer className={`toast activity-feed${error ? " error" : ""}`} aria-live="polite">
      <div className="activity-feed-tabs" role="tablist" aria-label="Activity">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "git"}
          className={activeTab === "git" ? "active" : ""}
          onClick={() => setActiveTab("git")}
        >
          {gitBusy ? <Loader2 size={12} className="spin" /> : null}
          Git
        </button>
        {sessions.map((session) => {
          const isActive = activeTab === session.runId;
          const isRunning = session.status === "running";
          return (
            <div key={session.runId} className={`activity-feed-terminal-tab ${session.status}${isActive ? " active" : ""}`}>
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                title={`Terminal: ${session.action.command}`}
                onClick={() => setActiveTab(session.runId)}
              >
                {isRunning ? <Loader2 size={12} className="spin" /> : <span className="activity-feed-session-dot" />}
                <span className="activity-feed-terminal-tab-label">Terminal: {session.action.name}</span>
              </button>
              <button
                type="button"
                className="activity-feed-tab-close"
                title={`Close terminal tab for ${session.action.command}; the command continues running`}
                aria-label={`Close terminal tab for ${session.action.command}`}
                onClick={() => onDismissExecution(session)}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>

      {activeTab === "git" ? (
        <div ref={gitScrollRef} className="activity-feed-scroll" onScroll={() => handleScroll("git")}>
          {error ? <pre>{error}</pre> : null}
          {message ? <pre>{message}</pre> : null}
          {!message && !error ? <div className="activity-feed-empty">No Git activity yet.</div> : null}
        </div>
      ) : activeSession ? (
        <>
          <div className="activity-feed-session-header">
            <div className="activity-feed-title">
              {activeSession.status === "running" ? (
                <Loader2 size={14} className="spin activity-feed-icon running" />
              ) : activeSession.status === "success" ? (
                <CheckCircle2 size={14} className="activity-feed-icon success" />
              ) : (
                <XCircle size={14} className="activity-feed-icon error" />
              )}
              <span className="activity-feed-command">$ {activeSession.action.command}</span>
            </div>
            <div className="activity-feed-actions">
              <button type="button" title="Rerun command" onClick={() => onRerun(activeSession.action)}>
                <RotateCcw size={12} />
              </button>
              <button type="button" title="Copy terminal output" onClick={() => handleCopy(activeSession)}>
                {copied ? <Check size={12} className="text-green" /> : <Copy size={12} />}
              </button>
              <button type="button" title="Clear terminal output" onClick={() => onClearExecution(activeSession)}>
                <Trash2 size={12} />
              </button>
              <button type="button" title="Open full terminal" onClick={() => onOpenExecution(activeSession)}>
                <ExternalLink size={12} />
              </button>
            </div>
          </div>
          <div ref={terminalScrollRef} className="activity-feed-scroll activity-feed-logs" onScroll={() => handleScroll("terminal")}>
            {activeSession.logs.length ? activeSession.logs.map((log) => (
              <div key={log.id} className={`activity-feed-log-line ${log.stream}`}>{log.line}</div>
            )) : <div className="activity-feed-empty">Waiting for process output…</div>}
          </div>
        </>
      ) : null}
    </footer>
  );
}
