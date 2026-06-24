export type DiffLine = {
  kind: "add" | "remove" | "context" | "meta";
  text: string;
  oldLine?: number;
  newLine?: number;
};

export type DiffHunk = {
  header: string;
  lines: DiffLine[];
};

export type DiffFile = {
  oldPath: string;
  newPath: string;
  isNew: boolean;
  isDeleted: boolean;
  isBinary: boolean;
  hunks: DiffHunk[];
  stats?: { additions: number; deletions: number };
};

export function parseUnifiedDiff(raw: string): DiffFile[] {
  if (!raw.trim()) {
    return [];
  }

  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const pushLine = (line: DiffLine) => {
    if (!currentHunk) {
      currentHunk = { header: "", lines: [] };
      current?.hunks.push(currentHunk);
    }
    currentHunk.lines.push(line);
  };

  for (const rawLine of raw.split("\n")) {
    if (rawLine.startsWith("diff --git ")) {
      if (current) {
        finalizeStats(current);
        files.push(current);
      }
      current = {
        oldPath: "",
        newPath: "",
        isNew: false,
        isDeleted: false,
        isBinary: false,
        hunks: [],
      };
      currentHunk = null;
      continue;
    }

    if (!current) {
      continue;
    }

    if (rawLine.startsWith("new file mode")) {
      current.isNew = true;
      continue;
    }
    if (rawLine.startsWith("deleted file mode")) {
      current.isDeleted = true;
      continue;
    }
    if (rawLine.startsWith("Binary files")) {
      current.isBinary = true;
      continue;
    }
    if (rawLine.startsWith("--- ")) {
      current.oldPath = rawLine.slice(4).trim();
      continue;
    }
    if (rawLine.startsWith("+++ ")) {
      current.newPath = rawLine.slice(4).trim();
      continue;
    }
    if (rawLine.startsWith("@@")) {
      currentHunk = { header: rawLine, lines: [] };
      current.hunks.push(currentHunk);
      const match = rawLine.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldLine = match ? Number(match[1]) : 0;
      newLine = match ? Number(match[2]) : 0;
      pushLine({ kind: "meta", text: rawLine });
      currentHunk.lines.pop();
      continue;
    }
    if (rawLine.startsWith("index ") || rawLine.startsWith("similarity index")) {
      pushLine({ kind: "meta", text: rawLine });
      continue;
    }

    if (!currentHunk) {
      currentHunk = { header: "", lines: [] };
      current.hunks.push(currentHunk);
    }

    if (rawLine.startsWith("+")) {
      pushLine({ kind: "add", text: rawLine.slice(1), newLine });
      newLine += 1;
    } else if (rawLine.startsWith("-")) {
      pushLine({ kind: "remove", text: rawLine.slice(1), oldLine });
      oldLine += 1;
    } else if (rawLine.startsWith(" ")) {
      pushLine({ kind: "context", text: rawLine.slice(1), oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    } else if (rawLine.startsWith("\\ No newline")) {
      pushLine({ kind: "meta", text: rawLine });
    }
  }

  if (current) {
    finalizeStats(current);
    files.push(current);
  }

  return files;
}

function finalizeStats(file: DiffFile) {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add") additions += 1;
      if (line.kind === "remove") deletions += 1;
    }
  }
  file.stats = { additions, deletions };
}

export function displayPath(file: DiffFile) {
  const clean = (path: string) => path.replace(/^a\//, "").replace(/^b\//, "");
  if (file.newPath && file.newPath !== "/dev/null") {
    return clean(file.newPath);
  }
  return clean(file.oldPath);
}
