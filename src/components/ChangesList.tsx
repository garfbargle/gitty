import type { FileChange } from "../types";
import { isStaged, isUnstaged, statusCode } from "../lib/git";

type ChangesListProps = {
  changes: FileChange[];
  selectedPath?: string;
  onSelect: (file: FileChange) => void;
  onStage: (files: string[]) => void;
  onUnstage: (files: string[]) => void;
  disabled?: boolean;
};

function statusClass(status: string) {
  const code = statusCode(status).toLowerCase();
  return code === "?" ? "untracked" : code;
}

export function ChangesList({
  changes,
  selectedPath,
  onSelect,
  onStage,
  onUnstage,
  disabled,
}: ChangesListProps) {
  const staged = changes.filter(isStaged);
  const unstaged = changes.filter(isUnstaged);

  return (
    <aside className="changes-list">
      <header className="panel-title">
        <span>Changes</span>
        <em>{changes.length}</em>
      </header>

      <section className="change-group">
        <h4>Unstaged ({unstaged.length})</h4>
        <div className="change-items">
          {unstaged.length === 0 ? (
            <p className="empty-hint">No unstaged files</p>
          ) : (
            unstaged.map((file) => (
              <div
                className={`change-item ${selectedPath === file.path ? "selected" : ""}`}
                key={`u-${file.path}`}
              >
                <input
                  type="checkbox"
                  checked={false}
                  disabled={disabled}
                  onChange={() => onStage([file.path])}
                />
                <button type="button" className="change-path" onClick={() => onSelect(file)}>
                  <span className={`status-chip ${statusClass(file.status)}`}>
                    {statusCode(file.status)}
                  </span>
                  <span>{file.path}</span>
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="change-group">
        <h4>Staged ({staged.length})</h4>
        <div className="change-items">
          {staged.length === 0 ? (
            <p className="empty-hint">Nothing staged</p>
          ) : (
            staged.map((file) => (
              <div
                className={`change-item ${selectedPath === file.path ? "selected" : ""}`}
                key={`s-${file.path}`}
              >
                <input
                  type="checkbox"
                  checked={true}
                  disabled={disabled}
                  onChange={() => onUnstage([file.path])}
                />
                <button type="button" className="change-path" onClick={() => onSelect(file)}>
                  <span className={`status-chip ${statusClass(file.status)}`}>
                    {statusCode(file.status)}
                  </span>
                  <span>{file.path}</span>
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      <div className="stage-dropzone">Drag files here to stage</div>
    </aside>
  );
}
