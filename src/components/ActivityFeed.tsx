import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  RotateCcw,
  Trash2,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ActionExecutionState, RepoAction } from "../types";

type ActivityFeedProps = {
  message: string;
  error: string;
  execution: ActionExecutionState | null;
  onOpenExecution: () => void;
  onRerun: (action: RepoAction) => void;
  onClearExecution: () => void;
  onDismissExecution: () => void;
};

const BOTTOM_TOLERANCE_PX = 12;

export function ActivityFeed({
  message,
  error,
  execution,
  onOpenExecution,
  onRerun,
  onClearExecution,
  onDismissExecution,
}: ActivityFeedProps) {
  const [copied, setCopied] = useState(false);
  const feedRef = useRef<HTMLElement>(null);
  const followLatestRef = useRef(true);

  const latestLogId = execution?.logs[execution.logs.length - 1]?.id;

  useEffect(() => {
    followLatestRef.current = true;
  }, [execution?.startTime]);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || !followLatestRef.current) return;
    feed.scrollTop = feed.scrollHeight;
  }, [message, error, execution?.status, latestLogId]);

  function handleScroll() {
    const feed = feedRef.current;
    if (!feed) return;
    const remaining = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
    followLatestRef.current = remaining <= BOTTOM_TOLERANCE_PX;
  }

  function handleCopy() {
    if (!execution) return;
    void navigator.clipboard.writeText(execution.logs.map((log) => log.line).join("\n"));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <footer
      ref={feedRef}
      className={`toast activity-feed${error ? " error" : ""}`}
      aria-live="polite"
      onScroll={handleScroll}
    >
      {execution ? (
        <div className="activity-feed-header">
          <div className="activity-feed-title">
            {execution.status === "running" ? (
              <Loader2 size={14} className="spin activity-feed-icon running" />
            ) : execution.status === "success" ? (
              <CheckCircle2 size={14} className="activity-feed-icon success" />
            ) : (
              <XCircle size={14} className="activity-feed-icon error" />
            )}
            <span className="activity-feed-command">$ {execution.action.command}</span>
            <span className="activity-feed-state">
              {execution.status === "running" ? "Running" : execution.status === "success" ? "Finished" : "Failed"}
            </span>
          </div>

          <div className="activity-feed-actions">
            <button type="button" title="Rerun command" onClick={() => onRerun(execution.action)}>
              <RotateCcw size={12} />
              <span>Rerun</span>
            </button>
            <button type="button" title="Copy script output" onClick={handleCopy}>
              {copied ? <Check size={12} className="text-green" /> : <Copy size={12} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
            <button type="button" title="Clear script output" onClick={onClearExecution}>
              <Trash2 size={12} />
              <span>Clear</span>
            </button>
            <button type="button" title="Open full terminal" onClick={onOpenExecution}>
              <ExternalLink size={12} />
              <span>Expand</span>
            </button>
            <button type="button" title="Hide script output" onClick={onDismissExecution}>
              <span>Hide</span>
            </button>
          </div>
        </div>
      ) : null}

      {error ? <pre>{error}</pre> : null}
      {message ? <pre>{message}</pre> : null}
      {execution?.logs.length ? (
        <div className="activity-feed-logs" aria-label="Script output">
          {execution.logs.map((log) => (
            <div key={log.id} className={`activity-feed-log-line ${log.stream}`}>
              {log.line}
            </div>
          ))}
        </div>
      ) : execution ? (
        <div className="activity-feed-empty">Waiting for process output…</div>
      ) : null}
    </footer>
  );
}
