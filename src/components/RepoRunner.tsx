import {
  ChevronDown,
  Play,
  Loader2,
  Package,
  Box,
  Wrench,
  FileCode,
  Terminal,
  Plus,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ActionExecutionState, RepoAction } from "../types";

type RepoRunnerProps = {
  repoPath: string;
  actions: RepoAction[];
  selectedActionId: string;
  activeExecution?: ActionExecutionState | null;
  onRunAction: (action: RepoAction) => void;
  onSelectAction: (action: RepoAction) => void;
  onRunCustomCommand?: (command: string) => void;
  onRemoveCustomAction?: (actionId: string) => void;
};

function getCategoryIcon(category: RepoAction["category"], size: number) {
  switch (category) {
    case "npm":
      return <Package size={size} className="repo-runner-cat-icon npm" />;
    case "cargo":
      return <Box size={size} className="repo-runner-cat-icon cargo" />;
    case "make":
      return <Wrench size={size} className="repo-runner-cat-icon make" />;
    case "script":
      return <FileCode size={size} className="repo-runner-cat-icon script" />;
    default:
      return <Terminal size={size} className="repo-runner-cat-icon custom" />;
  }
}

export function RepoRunner({
  repoPath,
  actions,
  selectedActionId,
  activeExecution,
  onRunAction,
  onSelectAction,
  onRunCustomCommand,
  onRemoveCustomAction,
}: RepoRunnerProps) {
  const [open, setOpen] = useState(false);
  const [customCommandInput, setCustomCommandInput] = useState("");
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setShowCustomPrompt(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setShowCustomPrompt(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!repoPath) return null;

  // A project that declares no scripts still gets the button — the menu opens
  // straight onto the "type a command" field instead of a list.
  const selectedAction =
    actions.find((a) => a.id === selectedActionId) ?? actions[0] ?? null;
  const hasActions = actions.length > 0;

  const isRunning = activeExecution?.status === "running";

  function openCustomPrompt() {
    setOpen(true);
    setShowCustomPrompt(true);
  }

  function handleSelectAction(action: RepoAction) {
    onSelectAction(action);
    setOpen(false);
  }

  function handleCustomSubmit(e: React.FormEvent) {
    e.preventDefault();
    const command = customCommandInput.trim();
    if (!command) return;
    setShowCustomPrompt(false);
    setOpen(false);
    if (onRunCustomCommand) {
      onRunCustomCommand(command);
    } else {
      onRunAction({
        id: `custom:${Date.now()}`,
        name: command,
        command,
        category: "custom",
        description: "Custom command",
      });
    }
    setCustomCommandInput("");
  }

  // Group actions by category
  const categories: Record<string, RepoAction[]> = {};
  for (const action of actions) {
    if (!categories[action.category]) {
      categories[action.category] = [];
    }
    categories[action.category].push(action);
  }

  const categoryLabels: Record<string, string> = {
    npm: "Node / Package Scripts",
    cargo: "Cargo Commands",
    make: "Makefile Targets",
    script: "Shell Scripts",
    custom: "Your Commands",
  };

  return (
    <div className={`repo-runner ${open ? "open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className={`repo-runner-main ${isRunning ? "running" : ""}`}
        title={
          selectedAction ? `Run ${selectedAction.command}` : "Add a command to run"
        }
        aria-label={
          selectedAction ? `Run ${selectedAction.command}` : "Add a command to run"
        }
        onClick={() =>
          selectedAction ? onRunAction(selectedAction) : openCustomPrompt()
        }
      >
        {isRunning ? (
          <Loader2 size={13} className="spin text-blue" />
        ) : selectedAction ? (
          <Play size={13} className="play-icon" />
        ) : (
          <Plus size={13} className="repo-runner-cat-icon custom" />
        )}
        <span className="repo-runner-label">
          {selectedAction ? selectedAction.name : "Add a command"}
        </span>
      </button>
      <button
        type="button"
        className="repo-runner-caret"
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Choose a command to run"
        aria-label="Choose a command to run"
        onClick={() => {
          setOpen((val) => !val);
          if (!hasActions) setShowCustomPrompt(true);
        }}
      >
        <ChevronDown size={12} />
      </button>

      {open ? (
        <div className="repo-runner-menu" role="listbox">
          {hasActions ? (
            Object.entries(categories).map(([catKey, catActions]) => (
              <div key={catKey} className="repo-runner-group">
                <div className="repo-runner-group-title">
                  {categoryLabels[catKey] || catKey}
                </div>
                {catActions.map((action) => (
                  <div key={action.id} className="repo-runner-row">
                    <button
                      type="button"
                      role="option"
                      aria-selected={action.id === selectedAction?.id}
                      className={`repo-runner-item ${
                        action.id === selectedAction?.id ? "active" : ""
                      }`}
                      onClick={() => handleSelectAction(action)}
                    >
                      {getCategoryIcon(action.category, 14)}
                      <div className="repo-runner-item-content">
                        <div className="repo-runner-item-name">{action.name}</div>
                        {action.description ? (
                          <div className="repo-runner-item-cmd">
                            {action.description}
                          </div>
                        ) : null}
                      </div>
                    </button>
                    {action.category === "custom" && onRemoveCustomAction ? (
                      <button
                        type="button"
                        className="repo-runner-remove"
                        title={`Remove ${action.name}`}
                        aria-label={`Remove ${action.name}`}
                        onClick={() => onRemoveCustomAction(action.id)}
                      >
                        <X size={12} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div className="repo-runner-empty">
              No commands found in this folder. Type one below — it's saved here
              for next time.
            </div>
          )}

          <div className="repo-runner-divider" />

          {showCustomPrompt ? (
            <form className="repo-runner-custom-form" onSubmit={handleCustomSubmit}>
              <input
                type="text"
                className="repo-runner-custom-input"
                placeholder="e.g. npm run deploy"
                value={customCommandInput}
                onChange={(e) => setCustomCommandInput(e.target.value)}
                autoFocus
              />
              <button type="submit" className="repo-runner-custom-btn">
                Run
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="repo-runner-item custom-trigger"
              onClick={() => setShowCustomPrompt(true)}
            >
              <Plus size={14} className="repo-runner-cat-icon custom" />
              <span>Add a command…</span>
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
