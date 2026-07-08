// Helpers for inline single-line edits in the changes view. A diff line carries
// its 1-based position in the working-tree file (`newLine`); these functions map
// that back onto the file's raw contents while preserving the file's existing
// line-ending style and trailing newline.

function detectEol(content: string): "\r\n" | "\n" {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function hasTrailingNewline(content: string): boolean {
  return /\r?\n$/.test(content);
}

/** Splits into lines without the trailing empty entry a final newline would add. */
function toLines(content: string): string[] {
  const body = hasTrailingNewline(content) ? content.replace(/\r?\n$/, "") : content;
  return body.split(/\r?\n/);
}

/** Returns the text of the given 1-based line, or null if out of range. */
export function getLine(content: string, lineNumber: number): string | null {
  const lines = toLines(content);
  const index = lineNumber - 1;
  if (index < 0 || index >= lines.length) return null;
  return lines[index];
}

/**
 * Replaces the given 1-based line's text, keeping every other line, the file's
 * line-ending style, and its trailing-newline state intact. Throws if the line
 * number is out of range.
 */
export function replaceLine(content: string, lineNumber: number, text: string): string {
  const lines = toLines(content);
  const index = lineNumber - 1;
  if (index < 0 || index >= lines.length) {
    throw new Error(`Line ${lineNumber} is out of range.`);
  }
  lines[index] = text;
  const eol = detectEol(content);
  return lines.join(eol) + (hasTrailingNewline(content) ? eol : "");
}
