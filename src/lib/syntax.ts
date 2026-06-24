export type SyntaxToken = {
  className?: string;
  text: string;
};

const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "import", "export", "from", "async", "await", "class", "interface", "type",
  "new", "true", "false", "null", "undefined", "throw", "try", "catch",
]);

export function tokenizeLine(line: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = [];
  let i = 0;

  while (i < line.length) {
    if (line[i] === "/" && line[i + 1] === "/") {
      tokens.push({ className: "syn-cmt", text: line.slice(i) });
      break;
    }
    if (line[i] === '"' || line[i] === "'" || line[i] === "`") {
      const quote = line[i];
      let j = i + 1;
      while (j < line.length && line[j] !== quote) j += 1;
      if (j < line.length) j += 1;
      tokens.push({ className: "syn-str", text: line.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(line[i])) {
      let j = i + 1;
      while (j < line.length && /[0-9.x]/.test(line[j])) j += 1;
      tokens.push({ className: "syn-num", text: line.slice(i, j) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_$]/.test(line[i])) {
      let j = i + 1;
      while (j < line.length && /[\w$]/.test(line[j])) j += 1;
      const word = line.slice(i, j);
      tokens.push({
        className: KEYWORDS.has(word) ? "syn-kw" : "syn-id",
        text: word,
      });
      i = j;
      continue;
    }
    tokens.push({ text: line[i] });
    i += 1;
  }

  return tokens;
}
