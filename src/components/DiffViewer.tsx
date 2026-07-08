import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MoreHorizontal } from "lucide-react";
import {
  displayPath,
  parseUnifiedDiff,
  serializeHunkPatch,
  type DiffFileBundle,
  type DiffHunkScope,
  type DiffLine,
  type ScopedDiffHunk,
} from "../lib/diff";
import { type FileImagePreview, isImagePath } from "../lib/images";
import { tokenizeLine } from "../lib/syntax";
import type { ChangeSection, FileChange } from "../types";
import { isStaged as isFileStaged } from "../lib/git";
import { FilePathLabel } from "./FilePathLabel";

export type DiffSelectionEntry = {
  file: FileChange;
  section: ChangeSection;
};

type DiffViewerProps = {
  raw: string;
  diffBundles?: DiffFileBundle[];
  file?: FileChange | null;
  selection?: DiffSelectionEntry[];
  repoPath?: string;
  section?: ChangeSection;
  commit?: string;
  showWorkingTreeBadges?: boolean;
  emptyMessage?: string;
  disabled?: boolean;
  onUnstage?: (path: string) => void;
  onStageHunk?: (filePath: string, patch: string) => void;
  onUnstageHunk?: (filePath: string, patch: string) => void;
  onDiscardHunk?: (filePath: string, patch: string) => void;
  onEditLine?: (filePath: string, newLine: number, expected: string, text: string) => void;
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

function DiffLineRow({
  line,
  filePath,
  editable,
  disabled,
  onEditLine,
}: {
  line: DiffLine;
  filePath: string;
  editable?: boolean;
  disabled?: boolean;
  onEditLine?: (filePath: string, newLine: number, expected: string, text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(line.text);

  const canEdit =
    !!editable &&
    !disabled &&
    !!onEditLine &&
    (line.kind === "add" || line.kind === "context") &&
    line.newLine != null;

  function startEditing() {
    if (!canEdit) return;
    setValue(line.text);
    setEditing(true);
  }

  function commit() {
    setEditing(false);
    if (value !== line.text && line.newLine != null) {
      onEditLine?.(filePath, line.newLine, line.text, value);
    }
  }

  const isBody =
    line.kind === "context" || line.kind === "add" || line.kind === "remove";

  return (
    <div className={`diff-line ${line.kind}${canEdit ? " editable" : ""}`}>
      <span className="diff-gutter old">{line.kind === "add" ? "" : (line.oldLine ?? "")}</span>
      <span className="diff-gutter new">{line.kind === "remove" ? "" : (line.newLine ?? "")}</span>
      <span className="diff-sign">
        {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
      </span>
      {editing ? (
        <input
          className="diff-edit-input"
          value={value}
          autoFocus
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setValue(line.text);
              setEditing(false);
            }
          }}
        />
      ) : isBody ? (
        <span
          className="diff-text-slot"
          onClick={canEdit ? startEditing : undefined}
          title={canEdit ? "Click to edit this line" : undefined}
        >
          <HighlightedLine text={line.text || " "} />
        </span>
      ) : (
        <code className="diff-text meta">{line.text}</code>
      )}
    </div>
  );
}

function DiffHunkView({
  scopedHunk,
  filePath,
  showActions,
  editable,
  disabled,
  onStageHunk,
  onUnstageHunk,
  onDiscardHunk,
  onEditLine,
}: {
  scopedHunk: ScopedDiffHunk;
  filePath: string;
  showActions?: boolean;
  editable?: boolean;
  disabled?: boolean;
  onStageHunk?: (filePath: string, patch: string) => void;
  onUnstageHunk?: (filePath: string, patch: string) => void;
  onDiscardHunk?: (filePath: string, patch: string) => void;
  onEditLine?: (filePath: string, newLine: number, expected: string, text: string) => void;
}) {
  const { hunk, scope, file } = scopedHunk;
  const canStage = showActions && scope === "unstaged" && onStageHunk;
  const canDiscard = showActions && scope === "unstaged" && onDiscardHunk;
  const canUnstage = showActions && scope === "staged" && onUnstageHunk;

  function stageHunk() {
    onStageHunk?.(filePath, serializeHunkPatch(file, hunk));
  }

  function discardHunk() {
    onDiscardHunk?.(filePath, serializeHunkPatch(file, hunk));
  }

  function unstageHunk() {
    onUnstageHunk?.(filePath, serializeHunkPatch(file, hunk));
  }

  return (
    <div className="diff-hunk-view">
      {hunk.header ? (
        <div className="diff-hunk-header">
          <span className="diff-hunk-header-main">
            <code>{hunk.header}</code>
            {showActions ? (
              <span className={`diff-hunk-scope ${scope}`}>
                {scope === "staged" ? "Staged" : "Unstaged"}
              </span>
            ) : null}
          </span>
          {canStage || canDiscard || canUnstage ? (
            <div className="diff-hunk-actions">
              {canDiscard ? (
                <button
                  type="button"
                  className="ghost-btn sm diff-hunk-action danger"
                  disabled={disabled}
                  onClick={discardHunk}
                >
                  Discard hunk
                </button>
              ) : null}
              {canStage ? (
                <button
                  type="button"
                  className="ghost-btn sm diff-hunk-action"
                  disabled={disabled}
                  onClick={stageHunk}
                >
                  Stage hunk
                </button>
              ) : null}
              {canUnstage ? (
                <button
                  type="button"
                  className="ghost-btn sm diff-hunk-action"
                  disabled={disabled}
                  onClick={unstageHunk}
                >
                  Unstage hunk
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="diff-lines">
        {hunk.lines.map((line, lineIndex) => (
          <DiffLineRow
            line={line}
            filePath={filePath}
            editable={editable && scope === "unstaged"}
            disabled={disabled}
            onEditLine={onEditLine}
            key={`${line.kind}-${lineIndex}`}
          />
        ))}
      </div>
    </div>
  );
}

function DiffFileSection({
  bundle,
  fileChange,
  section,
  visibleScopes,
  repoPath,
  commit,
  showWorkingTreeBadges,
  showHunkActions,
  editable,
  showHeader = true,
  disabled,
  onUnstage,
  onStageHunk,
  onUnstageHunk,
  onDiscardHunk,
  onEditLine,
}: {
  bundle: DiffFileBundle;
  fileChange?: FileChange;
  section?: ChangeSection;
  visibleScopes?: Set<DiffHunkScope>;
  showHeader?: boolean;
  repoPath?: string;
  commit?: string;
  showWorkingTreeBadges?: boolean;
  showHunkActions?: boolean;
  editable?: boolean;
  disabled?: boolean;
  onUnstage?: (path: string) => void;
  onStageHunk?: (filePath: string, patch: string) => void;
  onUnstageHunk?: (filePath: string, patch: string) => void;
  onDiscardHunk?: (filePath: string, patch: string) => void;
  onEditLine?: (filePath: string, newLine: number, expected: string, text: string) => void;
}) {
  const [imagePreview, setImagePreview] = useState<FileImagePreview | null>(null);
  const [imagePreviewLoading, setImagePreviewLoading] = useState(false);
  const [imagePreviewError, setImagePreviewError] = useState<string | null>(null);

  const diffFile = bundle.file;
  const filePath = bundle.path;
  const staged = fileChange ? isFileStaged(fileChange) : false;
  // When a specific staged/unstaged entry is selected, only show that scope's
  // hunks — a partially-staged file otherwise shows both scopes at once.
  const visibleHunks = visibleScopes
    ? bundle.hunks.filter((scoped) => visibleScopes.has(scoped.scope))
    : bundle.hunks;
  const showImagePreview =
    !!repoPath && !!filePath && diffFile.isBinary && isImagePath(filePath);

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

  return (
    <section className="diff-file-section">
      {showHeader ? (
        <header className="diff-file-header">
          <FilePathLabel path={filePath} className="diff-path" />
          {showWorkingTreeBadges && fileChange ? (
            staged ? (
              <span className="badge staged">Staged</span>
            ) : (
              <span className="badge unstaged">Unstaged</span>
            )
          ) : null}
          {showWorkingTreeBadges && staged && onUnstage && fileChange ? (
            <button type="button" className="ghost-btn sm" onClick={() => onUnstage(fileChange.path)}>
              Unstage
            </button>
          ) : null}
        </header>
      ) : null}

      {diffFile.isBinary ? (
        showImagePreview ? (
          imagePreviewLoading ? (
            <div className="diff-empty inline">Loading image preview…</div>
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
            <div className="diff-empty inline">
              {imagePreviewError ?? "Binary file — no text diff available."}
            </div>
          )
        ) : (
          <div className="diff-empty inline">Binary file — no text diff available.</div>
        )
      ) : visibleHunks.length === 0 ? (
        <div className="diff-empty inline">No diff hunks for this file.</div>
      ) : (
        visibleHunks.map((scopedHunk, index) => (
          <DiffHunkView
            scopedHunk={scopedHunk}
            filePath={filePath}
            showActions={showHunkActions}
            editable={editable}
            disabled={disabled}
            onStageHunk={onStageHunk}
            onUnstageHunk={onUnstageHunk}
            onDiscardHunk={onDiscardHunk}
            onEditLine={onEditLine}
            key={`${scopedHunk.scope}-${scopedHunk.hunk.header}-${index}`}
          />
        ))
      )}
    </section>
  );
}

function bundlesFromRaw(raw: string): DiffFileBundle[] {
  return parseUnifiedDiff(raw).map((file) => ({
    path: displayPath(file),
    file,
    hunks: file.hunks
      .filter((hunk) => hunk.lines.some((line) => line.kind !== "meta"))
      .map((hunk) => ({ hunk, scope: "unstaged" as DiffHunkScope, file })),
  }));
}

export function DiffViewer({
  raw,
  diffBundles,
  file,
  selection = [],
  repoPath,
  section,
  commit,
  showWorkingTreeBadges = true,
  emptyMessage,
  disabled,
  onUnstage,
  onStageHunk,
  onUnstageHunk,
  onDiscardHunk,
  onEditLine,
}: DiffViewerProps) {
  const bundles = useMemo(
    () => diffBundles ?? (raw.trim() ? bundlesFromRaw(raw) : []),
    [diffBundles, raw],
  );
  const showHunkActions =
    showWorkingTreeBadges &&
    !commit &&
    !!(onStageHunk || onUnstageHunk || onDiscardHunk);
  // Inline editing works on real working-tree files, so only in the working-tree
  // view (never a historical commit) and only when a save handler is wired in.
  const editable = showWorkingTreeBadges && !commit && !!onEditLine;

  const metaByPath = useMemo(() => {
    const map = new Map<string, DiffSelectionEntry>();
    for (const entry of selection) {
      if (!map.has(entry.file.path)) {
        map.set(entry.file.path, entry);
      }
    }
    if (file && section) {
      map.set(file.path, { file, section });
    }
    return map;
  }, [file, section, selection]);

  // Track which scopes (staged/unstaged) were actually selected for each path so
  // a partially-staged file only shows the hunks matching the chosen entry.
  const scopesByPath = useMemo(() => {
    const map = new Map<string, Set<DiffHunkScope>>();
    const add = (path: string, entrySection?: ChangeSection) => {
      if (entrySection !== "staged" && entrySection !== "unstaged") return;
      let scopes = map.get(path);
      if (!scopes) {
        scopes = new Set<DiffHunkScope>();
        map.set(path, scopes);
      }
      scopes.add(entrySection);
    };
    for (const entry of selection) add(entry.file.path, entry.section);
    if (file && section) add(file.path, section);
    return map;
  }, [file, section, selection]);

  const uniqueSelectionCount = useMemo(() => {
    const paths = new Set(selection.map((entry) => entry.file.path));
    if (file) paths.add(file.path);
    return paths.size;
  }, [file, selection]);

  const multiFile = uniqueSelectionCount > 1 || bundles.length > 1;

  if (bundles.length === 0) {
    const message =
      raw.trim() && !diffBundles
        ? raw.trim()
        : (emptyMessage ?? "Select a file to view its diff.");
    return (
      <section className="diff-panel-center">
        <div className="diff-empty">{message}</div>
      </section>
    );
  }

  const primaryPath = file?.path ?? bundles[0]?.path ?? "";

  return (
    <section className="diff-panel-center">
      <header className="diff-toolbar">
        <div className="diff-toolbar-left">
          {multiFile ? (
            <span className="diff-selection-label">{uniqueSelectionCount} files selected</span>
          ) : (
            <>
              <FilePathLabel path={primaryPath} className="diff-path" />
              {showWorkingTreeBadges && file ? (
                isFileStaged(file) ? (
                  <span className="badge staged">Staged</span>
                ) : (
                  <span className="badge unstaged">Unstaged</span>
                )
              ) : null}
            </>
          )}
        </div>
        <div className="diff-toolbar-right">
          {!multiFile && showWorkingTreeBadges && file && isFileStaged(file) && onUnstage ? (
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
        {bundles.map((bundle) => {
          const meta = metaByPath.get(bundle.path);
          return (
            <DiffFileSection
              bundle={bundle}
              fileChange={meta?.file}
              section={meta?.section ?? section}
              visibleScopes={scopesByPath.get(bundle.path)}
              repoPath={repoPath}
              commit={commit}
              showWorkingTreeBadges={showWorkingTreeBadges}
              showHunkActions={showHunkActions}
              editable={editable}
              showHeader={multiFile}
              disabled={disabled}
              onUnstage={onUnstage}
              onStageHunk={onStageHunk}
              onUnstageHunk={onUnstageHunk}
              onDiscardHunk={onDiscardHunk}
              onEditLine={onEditLine}
              key={bundle.path}
            />
          );
        })}
      </div>
    </section>
  );
}
