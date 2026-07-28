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
  const terminalEndRef = useRef<HTMLDivElement>(null);

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
    // Auto-scroll terminal output to bottom
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [execution?.logs.length]);

  if (!execution) return null;

  const seconds = (elapsedMs / 1000).toFixed(1);

  function handleCopy() {
    if (!execution) return;
    const text = execution.logs.map((l) => l.line).join("\n");
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

      <div className="action-runner-terminal">
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
              {log.line}
            </div>
          ))
        )}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
}
