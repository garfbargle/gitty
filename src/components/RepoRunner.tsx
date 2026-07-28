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
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ActionExecutionState, RepoAction } from "../types";

type RepoRunnerProps = {
  repoPath: string;
  actions: RepoAction[];
  activeExecution?: ActionExecutionState | null;
  onRunAction: (action: RepoAction) => void;
  onRunCustomCommand?: (command: string) => void;
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
  activeExecution,
  onRunAction,
  onRunCustomCommand,
}: RepoRunnerProps) {
  const [open, setOpen] = useState(false);
  const [customCommandInput, setCustomCommandInput] = useState("");
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const storageKey = `gitty.defaultAction:${repoPath}`;
  const [defaultActionId, setDefaultActionId] = useState<string>(() => {
    return localStorage.getItem(storageKey) ?? "";
  });

  useEffect(() => {
    if (!repoPath) return;
    const stored = localStorage.getItem(`gitty.defaultAction:${repoPath}`);
    if (stored) {
      setDefaultActionId(stored);
    } else if (actions.length > 0) {
      // Pick a smart default: preferred dev/build/tauri script, or first action
      const preferred =
        actions.find((a) => a.command.includes("tauri build")) ||
        actions.find((a) => a.command.includes("dev")) ||
        actions.find((a) => a.command.includes("build")) ||
        actions[0];
      if (preferred) {
        setDefaultActionId(preferred.id);
      }
    }
  }, [repoPath, actions]);

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
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (!repoPath || actions.length === 0) return null;

  const selectedAction =
    actions.find((a) => a.id === defaultActionId) ?? actions[0];

  const isRunning = activeExecution?.status === "running";

  function handleSelectAction(action: RepoAction) {
    setDefaultActionId(action.id);
    localStorage.setItem(storageKey, action.id);
    setOpen(false);
    onRunAction(action);
  }

  function handleCustomSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customCommandInput.trim()) return;
    const customAction: RepoAction = {
      id: `custom:${Date.now()}`,
      name: customCommandInput.trim(),
      command: customCommandInput.trim(),
      category: "custom",
      description: "Custom command",
    };
    setShowCustomPrompt(false);
    setOpen(false);
    if (onRunCustomCommand) {
      onRunCustomCommand(customCommandInput.trim());
    } else {
      onRunAction(customAction);
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
    custom: "Custom Commands",
  };

  return (
    <div className={`repo-runner ${open ? "open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className={`repo-runner-main ${isRunning ? "running" : ""}`}
        title={`Run ${selectedAction.command}`}
        aria-label={`Run ${selectedAction.command}`}
        disabled={!repoPath}
        onClick={() => onRunAction(selectedAction)}
      >
        {isRunning ? (
          <Loader2 size={13} className="spin text-blue" />
        ) : (
          <Play size={13} className="play-icon" />
        )}
        <span className="repo-runner-label">{selectedAction.name}</span>
      </button>
      <button
        type="button"
        className="repo-runner-caret"
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Choose a command to run"
        aria-label="Choose a command to run"
        onClick={() => setOpen((val) => !val)}
      >
        <ChevronDown size={12} />
      </button>

      {open ? (
        <div className="repo-runner-menu" role="listbox">
          {Object.entries(categories).map(([catKey, catActions]) => (
            <div key={catKey} className="repo-runner-group">
              <div className="repo-runner-group-title">
                {categoryLabels[catKey] || catKey}
              </div>
              {catActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  role="option"
                  aria-selected={action.id === selectedAction.id}
                  className={`repo-runner-item ${
                    action.id === selectedAction.id ? "active" : ""
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
              ))}
            </div>
          ))}

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
              <span>Run custom command…</span>
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
