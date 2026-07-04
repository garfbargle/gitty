import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { shortenPath } from "../lib/git";
import type { RepoEntry } from "../types";
import { RepoIcon } from "./RepoIcon";

type RepoPickerProps = {
  repos: RepoEntry[];
  selectedPath: string;
  onChange: (path: string) => void;
};

export function RepoPicker({ repos, selectedPath, onChange }: RepoPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = repos.find((repo) => repo.path === selectedPath) ?? repos[0];

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function selectRepo(path: string) {
    setOpen(false);
    if (path !== selectedPath) onChange(path);
  }

  if (!selected) return null;

  return (
    <div className={`repo-picker ${open ? "open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="repo-picker-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((value) => !value)}
      >
        <RepoIcon path={selected.path} name={selected.name} size={18} />
        <span className="repo-picker-name-row">
          <span className="repo-picker-name">{selected.name}</span>
          {selected.hasUncommittedChanges ? (
            <span
              className="repo-dirty-dot"
              title="Uncommitted changes"
              aria-label="Uncommitted changes"
            />
          ) : null}
        </span>
        <ChevronDown size={14} className="picker-chevron" />
      </button>

      {open ? (
        <div className="repo-picker-menu" role="listbox">
          {repos.map((repo) => (
            <button
              key={repo.id}
              type="button"
              role="option"
              aria-selected={repo.path === selectedPath}
              className={`repo-picker-item ${repo.path === selectedPath ? "active" : ""}`}
              title={repo.path}
              onClick={() => selectRepo(repo.path)}
            >
              <RepoIcon path={repo.path} name={repo.name} size={18} />
              <span className="repo-picker-text">
                <span className="repo-picker-name-row">
                  <span className="repo-picker-item-name">{repo.name}</span>
                  {repo.hasUncommittedChanges ? (
                    <span
                      className="repo-dirty-dot"
                      title="Uncommitted changes"
                      aria-label="Uncommitted changes"
                    />
                  ) : null}
                </span>
                <small>{shortenPath(repo.path)}</small>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
