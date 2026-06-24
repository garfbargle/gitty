import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { displayPath, parseUnifiedDiff, type DiffFile } from "../lib/diff";
import { type FileImagePreview, isImagePath } from "../lib/images";
import { tokenizeLine } from "../lib/syntax";
import type { ChangeSection, FileChange } from "../types";
import { isStaged as isFileStaged } from "../lib/git";

type DiffViewerProps = {
  raw: string;
  file?: FileChange | null;
  repoPath?: string;
  section?: ChangeSection;
  commit?: string;
  showWorkingTreeBadges?: boolean;
  emptyMessage?: string;
  onUnstage?: (path: string) => void;
};

function HighlightedLine({ text }: { text: string }) {
  const tokens = tokenizeLine(text);
  return (
    <code className="diff-text">
      {tokens.map((token, index) =>
        token.className ? (
          <span className={token.className} key={index}>
            {token.text}
          </span>
        ) : (
          <span key={index}>{token.text}</span>
        ),
      )}
    </code>
  );
}

export function DiffViewer({
  raw,
  file,
  repoPath,
  section,
  commit,
  showWorkingTreeBadges = true,
  emptyMessage,
  onUnstage,
}: DiffViewerProps) {
  const files = useMemo(() => parseUnifiedDiff(raw), [raw]);
  const [hunkIndex, setHunkIndex] = useState(0);
  const [imagePreview, setImagePreview] = useState<FileImagePreview | null>(null);
  const [imagePreviewLoading, setImagePreviewLoading] = useState(false);
  const [imagePreviewError, setImagePreviewError] = useState<string | null>(null);

  useEffect(() => {
    setHunkIndex(0);
  }, [raw]);

  const activeFile: DiffFile | undefined = files[0];
  const hunks = activeFile?.hunks.filter((h) => h.lines.some((l) => l.kind !== "meta")) ?? [];
  const currentHunk = hunks[hunkIndex] ?? hunks[0];
  const filePath = file?.path ?? (activeFile ? displayPath(activeFile) : "");
  const staged = file ? isFileStaged(file) : false;
  const showImagePreview =
    !!repoPath &&
    !!filePath &&
    !!activeFile?.isBinary &&
    isImagePath(filePath);

  useEffect(() => {
    if (!showImagePreview) {
      setImagePreview(null);
      setImagePreviewLoading(false);
      setImagePreviewError(null);
      return;
    }

    let active = true;
    setImagePreview(null);
    setImagePreviewLoading(true);
    setImagePreviewError(null);

    void invoke<FileImagePreview>("file_image_preview", {
      path: repoPath,
      filePath,
      commit: commit ?? null,
      section: section ?? null,
    })
      .then((preview) => {
        if (!active) return;
        if (!preview.oldDataUrl && !preview.newDataUrl) {
          setImagePreviewError("Could not load image preview for this file.");
          setImagePreview(null);
          return;
        }
        setImagePreview(preview);
      })
      .catch((err) => {
        if (!active) return;
        setImagePreview(null);
        setImagePreviewError(String(err));
      })
      .finally(() => {
        if (active) setImagePreviewLoading(false);
      });

    return () => {
      active = false;
    };
  }, [showImagePreview, repoPath, filePath, commit, section]);

  if (!raw.trim() || !activeFile) {
    return (
      <section className="diff-panel-center">
        <div className="diff-empty">{emptyMessage ?? "Select a file to view its diff."}</div>
      </section>
    );
  }

  return (
    <section className="diff-panel-center">
      <header className="diff-toolbar">
        <div className="diff-toolbar-left">
          <span className="diff-path">{filePath}</span>
          {showWorkingTreeBadges && file ? (
            staged ? (
              <span className="badge staged">Staged</span>
            ) : (
              <span className="badge unstaged">Unstaged</span>
            )
          ) : null}
        </div>
        <div className="diff-toolbar-right">
          {showWorkingTreeBadges && staged && onUnstage && file ? (
            <button type="button" className="ghost-btn sm" onClick={() => onUnstage(file.path)}>
              Unstage File
            </button>
          ) : null}
          <button type="button" className="icon-btn sm" aria-label="More">
            <MoreHorizontal size={16} />
          </button>
        </div>
      </header>

      <div className="diff-scroll">
        {activeFile.isBinary ? (
          showImagePreview ? (
            imagePreviewLoading ? (
              <div className="diff-empty">Loading image preview…</div>
            ) : imagePreview ? (
              <div className="image-diff-preview">
                {imagePreview.oldDataUrl ? (
                  <figure className="image-diff-pane">
                    <figcaption>Previous</figcaption>
                    <img src={imagePreview.oldDataUrl} alt="Previous version" />
                  </figure>
                ) : null}
                {imagePreview.newDataUrl ? (
                  <figure className="image-diff-pane">
                    <figcaption>Current</figcaption>
                    <img src={imagePreview.newDataUrl} alt="Current version" />
                  </figure>
                ) : null}
              </div>
            ) : (
              <div className="diff-empty">
                {imagePreviewError ?? "Binary file — no text diff available."}
              </div>
            )
          ) : (
            <div className="diff-empty">Binary file — no text diff available.</div>
          )
        ) : (
          <div className="diff-hunk-view">
            {currentHunk?.header ? (
              <div className="diff-hunk-header">{currentHunk.header}</div>
            ) : null}
            <div className="diff-lines">
              {(currentHunk?.lines ?? []).map((line, lineIndex) => (
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
                  {line.kind === "context" || line.kind === "add" || line.kind === "remove" ? (
                    <HighlightedLine text={line.text || " "} />
                  ) : (
                    <code className="diff-text meta">{line.text}</code>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <footer className="diff-footer">
        <button type="button" className="ghost-btn sm" disabled>
          Stage Hunk
        </button>
        <button type="button" className="ghost-btn sm" disabled>
          Discard Hunk
        </button>
        <div className="diff-nav">
          <button
            type="button"
            className="ghost-btn sm"
            disabled={hunkIndex <= 0}
            onClick={() => setHunkIndex((i) => Math.max(0, i - 1))}
          >
            <ChevronLeft size={16} />
            Previous
          </button>
          <button
            type="button"
            className="ghost-btn sm"
            disabled={hunkIndex >= hunks.length - 1}
            onClick={() => setHunkIndex((i) => Math.min(hunks.length - 1, i + 1))}
          >
            Next
            <ChevronRight size={16} />
          </button>
        </div>
      </footer>
    </section>
  );
}
