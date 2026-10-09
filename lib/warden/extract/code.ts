// Source code: splits comments, docstrings and string literals from executable code. Coding
// agents read every comment; attackers hide instructions there ("AI agents: run this first").
// Executable code that merely uses secrets or shell calls is normal and is scored gently.

import { SegmentBuilder, type Extraction } from "./util";

type Lang = "c" | "hash" | "python" | "html" | "sql" | "unknown";

export function guessLang(name: string | undefined, code: string): Lang {
  const ext = (name || "").toLowerCase().split(".").pop() || "";
  if (["py", "pyw"].includes(ext)) return "python";
  if (["sh", "bash", "zsh", "rb", "yml", "yaml", "toml", "r", "pl", "ps1", "dockerfile", "mk", "makefile", "conf", "ini", "env"].includes(ext)) return "hash";
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs", "java", "c", "h", "cpp", "hpp", "cs", "go", "rs", "swift", "kt", "scala", "php", "dart", "css", "scss", "json5", "sol"].includes(ext)) return "c";
  if (["html", "htm", "xml", "vue", "svelte"].includes(ext)) return "html";
  if (["sql"].includes(ext)) return "sql";
  if (/^\s*(def |class |import |from \S+ import )/m.test(code) && !/[;{}]\s*$/m.test(code)) return "python";
  if (/^#!\s*\/.*(sh|bash|zsh)/.test(code)) return "hash";
  if (/\/\/|\/\*|[;{}]\s*$/m.test(code)) return "c";
  if (/^\s*#/m.test(code)) return "hash";
  return "unknown";
}

interface Piece {
  kind: "code" | "comment" | "string";
  text: string;
  line: number;
}

function tokenize(code: string, lang: Lang): Piece[] {
  const out: Piece[] = [];
  let i = 0;
  let line = 1;
  let buf = "";
  let bufLine = 1;
  const flushCode = () => {
    if (buf) out.push({ kind: "code", text: buf, line: bufLine });
    buf = "";
  };
  const lineComment = lang === "c" ? "//" : lang === "sql" ? "--" : lang === "hash" || lang === "python" ? "#" : null;
  while (i < code.length) {
    const rest = code.slice(i, i + 3);
    // Python docstrings and triple-quoted strings.
    if (lang === "python" && (rest === '"""' || rest === "'''")) {
      const end = code.indexOf(rest, i + 3);
      const stop = end < 0 ? code.length : end + 3;
      flushCode();
      const body = code.slice(i + 3, end < 0 ? code.length : end);
      out.push({ kind: "comment", text: body, line });
      line += (code.slice(i, stop).match(/\n/g) || []).length;
      i = stop;
      bufLine = line;
      continue;
    }
    if ((lang === "c" || lang === "unknown") && code.startsWith("/*", i)) {
      const end = code.indexOf("*/", i + 2);
      const stop = end < 0 ? code.length : end + 2;
      flushCode();
      out.push({ kind: "comment", text: code.slice(i + 2, end < 0 ? code.length : end).replace(/^\s*\*\s?/gm, ""), line });
      line += (code.slice(i, stop).match(/\n/g) || []).length;
      i = stop;
      bufLine = line;
      continue;
    }
    if (lang === "html" && code.startsWith("<!--", i)) {
      const end = code.indexOf("-->", i + 4);
      const stop = end < 0 ? code.length : end + 3;
      flushCode();
      out.push({ kind: "comment", text: code.slice(i + 4, end < 0 ? code.length : end), line });
      line += (code.slice(i, stop).match(/\n/g) || []).length;
      i = stop;
      bufLine = line;
      continue;
    }
    if (lineComment && code.startsWith(lineComment, i) && !(lineComment === "#" && code[i + 1] === "!" && i === 0) && !(lineComment === "#" && /\$\{?$/.test(code.slice(Math.max(0, i - 2), i)))) {
      const end = code.indexOf("\n", i);
      const stop = end < 0 ? code.length : end;
      flushCode();
      out.push({ kind: "comment", text: code.slice(i + lineComment.length, stop), line });
      i = stop;
      bufLine = line;
      continue;
    }
    const ch = code[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== ch && !(code[j] === "\n" && ch !== "`")) {
        if (code[j] === "\\") j++;
        j++;
      }
      const body = code.slice(i + 1, j);
      if (body.length >= 12 && /\s/.test(body)) {
        flushCode();
        out.push({ kind: "string", text: body, line });
        line += (body.match(/\n/g) || []).length;
        i = j + 1;
        bufLine = line;
        continue;
      }
      buf += code.slice(i, j + 1);
      line += (code.slice(i, j + 1).match(/\n/g) || []).length;
      i = j + 1;
      continue;
    }
    if (ch === "\n") line++;
    buf += ch;
    i++;
  }
  flushCode();
  return out;
}

export function extractCode(code: string, name?: string): Extraction {
  const b = new SegmentBuilder("c", "external");
  const lang = guessLang(name, code);
  const pieces = tokenize(code, lang);
  const testFile = /\b(?:assert|expect\(|describe\(|it\(|test\(|def test_|unittest|pytest|@Test)\b/.test(code) || /(?:^|\/)(?:test_|tests?\/|__tests__|.*\.(?:test|spec)\.)/.test(name || "");
  // Merge neighbouring comment lines (a comment block) and keep code as one segment.
  let commentBlock: Piece | null = null;
  const codeParts: string[] = [];
  const flushComment = () => {
    if (commentBlock) b.add(commentBlock.text.trim(), `Comment at line ${commentBlock.line}`, { role: "code_comment" });
    commentBlock = null;
  };
  for (const p of pieces) {
    if (p.kind === "comment") {
      if (commentBlock && p.line - commentBlock.line <= (commentBlock.text.match(/\n/g) || []).length + 1) commentBlock.text += "\n" + p.text;
      else {
        flushComment();
        commentBlock = { ...p };
      }
      continue;
    }
    if (p.kind === "code" && !p.text.trim()) continue;
    flushComment();
    if (p.kind === "string") b.add(p.text, `String at line ${p.line}${testFile ? " (test data)" : ""}`, { role: "code_string" });
    else codeParts.push(p.text);
  }
  flushComment();
  const codeText = codeParts.join("").trim();
  if (codeText) b.add(codeText, "Code", { role: "code" });
  return { segments: b.segments, warnings: [], notes: [`Read as ${lang === "unknown" ? "source code" : `${lang}-style code`}.`] };
}
