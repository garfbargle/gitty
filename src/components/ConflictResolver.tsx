import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import type { ConflictSides } from "../types";

type ConflictResolverProps = {
  file: string | null;
  sides: ConflictSides | null;
  loading: boolean;
  oursLabel: string;
  theirsLabel: string;
  resolved: boolean;
  onUseOurs: () => void;
  onUseTheirs: () => void;
  onSaveManual: (content: string) => void;
};

function hasConflictMarkers(text: string) {
  return /^<<<<<<<|^=======|^>>>>>>>/m.test(text);
}

function CodeBlock({ text, tone }: { text: string; tone: "ours" | "theirs" }) {
  const lines = text.length ? text.replace(/\n$/, "").split("\n") : [];
  return (
    <div className={`conflict-code ${tone}`}>
      {lines.length === 0 ? (
        <div className="conflict-code-empty">(file is empty on this side)</div>
      ) : (
        lines.map((line, index) => (
          <div className="conflict-line" key={index}>
            <span className="conflict-gutter">{index + 1}</span>
            <span className="conflict-text">{line || " "}</span>
          </div>
        ))
      )}
    </div>
  );
}

export function ConflictResolver({
  file,
  sides,
  loading,
  oursLabel,
  theirsLabel,
  resolved,
  onUseOurs,
  onUseTheirs,
  onSaveManual,
}: ConflictResolverProps) {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setDraft(sides?.result ?? "");
  }, [sides?.result, file]);

  if (!file) {
    return (
      <div className="conflict-resolver empty">
        <AlertTriangle size={28} />
        <p>Select a conflicted file to resolve it.</p>
      </div>
    );
  }

  const stillConflicted = hasConflictMarkers(draft);
  const dirty = sides ? draft !== sides.result : false;

  return (
    <div className="conflict-resolver">
      <header className="conflict-header">
        <div className="conflict-file">
          <AlertTriangle size={14} className="conflict-file-icon" />
          <span className="conflict-file-name">{file}</span>
          {resolved ? (
            <span className="conflict-badge resolved">
              <Check size={11} /> Resolved
            </span>
          ) : (
            <span className="conflict-badge">Conflicted</span>
          )}
        </div>
        <div className="conflict-actions">
          <button type="button" className="conflict-choose" onClick={onUseOurs}>
            Use {oursLabel}
          </button>
          <button type="button" className="conflict-choose" onClick={onUseTheirs}>
            Use {theirsLabel}
          </button>
        </div>
      </header>

      {loading ? (
        <div className="conflict-loading">
          <Loader2 size={16} className="spin" />
          <span>Loading conflict…</span>
        </div>
      ) : sides ? (
        <div className="conflict-body">
          <section className="conflict-pane">
            <div className="conflict-pane-label ours">Current · {oursLabel}</div>
            <CodeBlock text={sides.ours} tone="ours" />
          </section>

          <section className="conflict-pane">
            <div className="conflict-pane-label theirs">Incoming · {theirsLabel}</div>
            <CodeBlock text={sides.theirs} tone="theirs" />
          </section>

          <section className="conflict-pane result">
            <div className="conflict-pane-label result">
              Result · edit to resolve
              {stillConflicted ? (
                <span className="conflict-pane-warn">conflict markers remain</span>
              ) : null}
            </div>
            <textarea
              className="conflict-result-input"
              value={draft}
              spellCheck={false}
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
            <div className="conflict-result-actions">
              <button
                type="button"
                className="conflict-save"
                disabled={!dirty || stillConflicted}
                onClick={() => onSaveManual(draft)}
                title={
                  stillConflicted
                    ? "Remove the <<<<<<< ======= >>>>>>> markers first"
                    : "Save this resolution and stage the file"
                }
              >
                <Check size={13} />
                Save resolution
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
