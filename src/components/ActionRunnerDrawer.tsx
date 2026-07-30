import {
  CheckCircle2,
  Copy,
  Loader2,
  RotateCcw,
  Trash2,
  X,
  XCircle,
  Check,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatLogTimestamp } from "../lib/logs";
import type { ActionExecutionState, RepoAction } from "../types";

type ActionRunnerDrawerProps = {
  execution: ActionExecutionState | null;
  onClose: () => void;
  onRerun: (action: RepoAction) => void;
  onClearLogs?: () => void;
};

export function ActionRunnerDrawer({
  execution,
  onClose,
  onRerun,
  onClearLogs,
}: ActionRunnerDrawerProps) {
  const [copied, setCopied] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const terminalRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);

  useEffect(() => {
    if (!execution) return;
    if (execution.status !== "running") {
      if (execution.endTime && execution.startTime) {
        setElapsedMs(execution.endTime - execution.startTime);
      }
      return;
    }

    const interval = setInterval(() => {
      setElapsedMs(Date.now() - execution.startTime);
    }, 100);

    return () => clearInterval(interval);
  }, [execution]);

  useEffect(() => {
    followLatestRef.current = true;
  }, [execution?.startTime]);

  useEffect(() => {
    // Follow new output until the user scrolls away from the bottom.
    const terminal = terminalRef.current;
    if (terminal && followLatestRef.current) {
      terminal.scrollTop = terminal.scrollHeight;
    }
  }, [execution?.logs.length]);

  if (!execution) return null;

  const seconds = (elapsedMs / 1000).toFixed(1);

  function handleCopy() {
    if (!execution) return;
    const text = execution.logs
      .map((log) => `[${formatLogTimestamp(log.timestamp)}] ${log.line}`)
      .join("\n");
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleTerminalScroll() {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const remaining = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight;
    followLatestRef.current = remaining <= 12;
  }

  return (
    <div className="action-runner-drawer">
      <div className="action-runner-drawer-header">
        <div className="action-runner-drawer-title">
          {execution.status === "running" ? (
            <Loader2 size={15} className="spin status-icon running" />
          ) : execution.status === "success" ? (
            <CheckCircle2 size={15} className="status-icon success" />
          ) : (
            <XCircle size={15} className="status-icon error" />
          )}

          <span className="action-runner-cmd">{execution.action.command}</span>

          <span className="action-runner-badge">
            {execution.status === "running"
              ? "Running..."
              : execution.status === "success"
                ? `Success (${seconds}s)`
                : `Failed (${execution.exitCode ?? 1})`}
          </span>

          <span className="action-runner-timer">{seconds}s</span>
        </div>

        <div className="action-runner-drawer-actions">
          <button
            type="button"
            className="action-runner-btn"
            title="Rerun command"
            onClick={() => onRerun(execution.action)}
          >
            <RotateCcw size={13} />
            <span>Rerun</span>
          </button>

          <button
            type="button"
            className="action-runner-btn"
            title="Copy logs to clipboard"
            onClick={handleCopy}
          >
            {copied ? <Check size={13} className="text-green" /> : <Copy size={13} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>

          {onClearLogs ? (
            <button
              type="button"
              className="action-runner-btn"
              title="Clear output"
              onClick={onClearLogs}
            >
              <Trash2 size={13} />
            </button>
          ) : null}

          <button
            type="button"
            className="action-runner-close-btn"
            title="Close terminal panel"
            onClick={onClose}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      <div
        ref={terminalRef}
        className="action-runner-terminal"
        onScroll={handleTerminalScroll}
      >
        {execution.logs.length === 0 ? (
          <div className="action-runner-terminal-empty">
            Waiting for process output…
          </div>
        ) : (
          execution.logs.map((log) => (
            <div
              key={log.id}
              className={`action-runner-log-line ${log.stream}`}
            >
              <span className="log-timestamp">[{formatLogTimestamp(log.timestamp)}]</span>{" "}
              {log.line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
