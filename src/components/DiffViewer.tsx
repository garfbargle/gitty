import { useMemo } from "react";
import { displayPath, parseUnifiedDiff } from "../lib/diff";

type DiffViewerProps = {
  raw: string;
  emptyMessage?: string;
};

export function DiffViewer({ raw, emptyMessage }: DiffViewerProps) {
  const files = useMemo(() => parseUnifiedDiff(raw), [raw]);

  if (!raw.trim()) {
    return <div className="diff-empty">{emptyMessage ?? "No diff to show."}</div>;
  }

  if (files.length === 0) {
    return <pre className="diff-fallback">{raw}</pre>;
  }

  return (
    <div className="diff-viewer">
      {files.map((file) => (
        <section className="diff-file" key={`${file.oldPath}-${file.newPath}`}>
          <header className="diff-file-header">
            <span className="diff-file-path">{displayPath(file)}</span>
            {file.stats ? (
              <span className="diff-file-stats">
                {file.stats.additions > 0 ? (
                  <em className="add">+{file.stats.additions}</em>
                ) : null}
                {file.stats.deletions > 0 ? (
                  <em className="del">-{file.stats.deletions}</em>
                ) : null}
              </span>
            ) : null}
          </header>

          {file.isBinary ? (
            <div className="diff-binary">Binary file — no text diff available.</div>
          ) : (
            file.hunks.map((hunk, hunkIndex) => (
              <div className="diff-hunk" key={`${hunk.header}-${hunkIndex}`}>
                {hunk.header ? <div className="diff-hunk-header">{hunk.header}</div> : null}
                <div className="diff-lines">
                  {hunk.lines.map((line, lineIndex) => (
                    <div className={`diff-line ${line.kind}`} key={`${line.kind}-${lineIndex}`}>
                      <span className="diff-gutter old">
                        {line.kind === "add" ? "" : line.oldLine ?? ""}
                      </span>
                      <span className="diff-gutter new">
                        {line.kind === "remove" ? "" : line.newLine ?? ""}
                      </span>
                      <span className="diff-sign">
                        {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
                      </span>
                      <code className="diff-text">{line.text || " "}</code>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </section>
      ))}
    </div>
  );
}
