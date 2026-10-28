export * as CodeLanguages from "./languages.js"

// What the code index understands of each language: its files, where symbols are declared and what it imports. These
// are line patterns, not parsers: fast, dependency-free, and right for the declarations people write every day.

export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "struct"
  | "trait"
  | "module"
  | "variable"
  | "macro"

export type Declaration = { name: string; kind: SymbolKind; line: number; indent: number }

type Rule = { pattern: RegExp; kind: SymbolKind | ((match: RegExpExecArray) => SymbolKind); name?: number }

type Language = {
  id: string
  rules: Rule[]
  imports: RegExp[]
  /** Line comments, so commented-out code declares nothing. */
  comment?: RegExp
}

const KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "function", "else", "new", "typeof", "await", "sizeof", "do",
  "try", "with", "case", "throw", "delete", "void", "in", "of", "elif", "except", "match", "when", "select", "defer",
  "go", "lock", "using", "foreach", "synchronized", "constructor", "super", "this", "self",
])

const kindOf = (word: string): SymbolKind =>
  ({ class: "class", interface: "interface", type: "type", enum: "enum", struct: "struct", trait: "trait", union: "struct",
     protocol: "interface", record: "class", object: "class", module: "module", namespace: "module", mod: "module",
     impl: "trait", extension: "class", actor: "class" })[word] as SymbolKind ?? "class"

const SLASH = /^\s*(\/\/|\/\*|\*)/
const HASH = /^\s*#/
const DASH = /^\s*--/

const C_LIKE_TYPES: Rule = {
  pattern: /^\s*(?:(?:public|private|protected|internal|static|abstract|final|sealed|partial|export|default|declare|open|data|inline|value|annotation|enum)\s+)*(class|interface|enum|struct|record|trait|object|union|namespace)\s+([A-Za-z_$][\w$]*)/,
  kind: (match) => kindOf(match[1]!),
  name: 2,
}

const LANGUAGES: Record<string, Language> = {
  typescript: {
    id: "typescript",
    comment: SLASH,
    rules: [
      { pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: "function" },
      { pattern: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: "class" },
      { pattern: /^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: "interface" },
      { pattern: /^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/, kind: "type" },
      { pattern: /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: "enum" },
      { pattern: /^\s*(?:export\s+)?(?:declare\s+)?(?:namespace|module)\s+([A-Za-z_$][\w$.]*)\s*\{/, kind: "module" },
      {
        pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>|Effect\.fn)/,
        kind: "function",
      },
      { pattern: /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, kind: "variable" },
      {
        pattern: /^\s+(?:(?:public|private|protected|static|readonly|async|override|abstract|get|set)\s+)*\*?([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^()]*\)\s*(?::\s*[^={;()]+)?\{\s*$/,
        kind: "method",
      },
    ],
    imports: [
      /^\s*import\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/,
      /^\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+['"]([^'"]+)['"]/,
      /\brequire\(\s*['"]([^'"]+)['"]\s*\)/,
      /\bimport\(\s*['"]([^'"]+)['"]\s*\)/,
    ],
  },
  python: {
    id: "python",
    comment: HASH,
    rules: [
      { pattern: /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)/, kind: "function", name: 2 },
      { pattern: /^\s*class\s+([A-Za-z_]\w*)/, kind: "class" },
      { pattern: /^([A-Z][A-Z0-9_]+)\s*(?::[^=]+)?=/, kind: "variable" },
    ],
    imports: [/^\s*from\s+([\w.]+)\s+import\b/, /^\s*import\s+([\w.]+)/],
  },
  go: {
    id: "go",
    comment: SLASH,
    rules: [
      { pattern: /^func\s+\([^)]*\)\s*([A-Za-z_]\w*)/, kind: "method" },
      { pattern: /^func\s+([A-Za-z_]\w*)/, kind: "function" },
      { pattern: /^type\s+([A-Za-z_]\w*)\s+(struct|interface)/, kind: (match) => (match[2] === "interface" ? "interface" : "struct") },
      { pattern: /^type\s+([A-Za-z_]\w*)\s/, kind: "type" },
    ],
    imports: [/^\s*import\s+(?:\w+\s+)?"([^"]+)"/, /^\s+(?:\w+\s+)?"([^"]+)"\s*$/],
  },
  rust: {
    id: "rust",
    comment: SLASH,
    rules: [
      { pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_]\w*)/, kind: "function" },
      { pattern: /^\s*(?:pub(?:\([^)]*\))?\s+)?(struct|enum|trait|union|mod|type)\s+([A-Za-z_]\w*)/, kind: (match) => (match[1] === "type" ? "type" : kindOf(match[1]!)), name: 2 },
      { pattern: /^\s*impl(?:<[^>]*>)?\s+(?:[\w:<>]+\s+for\s+)?([A-Za-z_]\w*)/, kind: "trait" },
      { pattern: /^\s*macro_rules!\s*([A-Za-z_]\w*)/, kind: "macro" },
    ],
    imports: [/^\s*(?:pub\s+)?use\s+([\w:]+)/, /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/],
  },
  java: {
    id: "java",
    comment: SLASH,
    rules: [
      C_LIKE_TYPES,
      {
        pattern: /^\s*(?:(?:public|private|protected|internal|static|final|abstract|synchronized|native|override|virtual|async|sealed|extern|unsafe|new|default)\s+)+[\w<>\[\],.?\s]*?\b([A-Za-z_]\w*)\s*\([^;]*$/,
        kind: "method",
      },
      { pattern: /^\s*(?:(?:public|private|protected|internal|override|suspend|inline|private|open|operator)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)/, kind: "function" },
      { pattern: /^\s*(?:(?:private|override|final|implicit|lazy)\s+)*def\s+([A-Za-z_]\w*)/, kind: "function" },
    ],
    imports: [/^\s*import\s+(?:static\s+)?([\w.]+)/, /^\s*using\s+(?:static\s+)?([\w.]+)\s*;/],
  },
  c: {
    id: "c",
    comment: SLASH,
    rules: [
      { pattern: /^\s*(?:typedef\s+)?(struct|enum|union|class|namespace)\s+([A-Za-z_]\w*)\s*(?:final\s*)?(?::[^{;]*)?\{?\s*$/, kind: (match) => kindOf(match[1]!), name: 2 },
      { pattern: /^#\s*define\s+([A-Za-z_]\w*)/, kind: "macro" },
      {
        pattern: /^(?:[A-Za-z_][\w:<>,*&\s]*?[\s*&])?((?:[A-Za-z_]\w*::)*~?[A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?\{?\s*$/,
        kind: "function",
      },
    ],
    imports: [/^\s*#\s*include\s*[<"]([^>"]+)[>"]/],
  },
  php: {
    id: "php",
    comment: /^\s*(\/\/|#|\/\*|\*)/,
    rules: [
      { pattern: /^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+&?([A-Za-z_]\w*)/, kind: "function" },
      { pattern: /^\s*(?:(?:final|abstract|readonly)\s+)*(class|interface|trait|enum)\s+([A-Za-z_]\w*)/, kind: (match) => kindOf(match[1]!), name: 2 },
    ],
    imports: [/^\s*use\s+([\w\\]+)/, /\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/],
  },
  ruby: {
    id: "ruby",
    comment: HASH,
    rules: [
      { pattern: /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/, kind: "method" },
      { pattern: /^\s*(class|module)\s+([A-Z][\w:]*)/, kind: (match) => kindOf(match[1]!), name: 2 },
    ],
    imports: [/^\s*require(?:_relative)?\s*\(?\s*['"]([^'"]+)['"]/],
  },
  swift: {
    id: "swift",
    comment: SLASH,
    rules: [
      { pattern: /^\s*(?:(?:public|private|fileprivate|internal|open|static|final|override|mutating|@\w+)\s+)*func\s+([A-Za-z_]\w*)/, kind: "function" },
      { pattern: /^\s*(?:(?:public|private|fileprivate|internal|open|final|indirect)\s+)*(class|struct|enum|protocol|extension|actor)\s+([A-Za-z_]\w*)/, kind: (match) => kindOf(match[1]!), name: 2 },
    ],
    imports: [/^\s*import\s+(\w+)/],
  },
  lua: {
    id: "lua",
    comment: DASH,
    rules: [{ pattern: /^\s*(?:local\s+)?function\s+([\w.:]+)/, kind: "function" }],
    imports: [/\brequire\s*\(?\s*['"]([^'"]+)['"]/],
  },
  shell: {
    id: "shell",
    comment: HASH,
    rules: [
      { pattern: /^\s*function\s+([\w-]+)/, kind: "function" },
      { pattern: /^\s*([\w-]+)\s*\(\)\s*\{?/, kind: "function" },
    ],
    imports: [/^\s*(?:source|\.)\s+['"]?([^'"\s]+)/],
  },
  powershell: {
    id: "powershell",
    comment: HASH,
    rules: [{ pattern: /^\s*function\s+([\w-]+)/i, kind: "function" }, { pattern: /^\s*class\s+(\w+)/i, kind: "class" }],
    imports: [/^\s*(?:Import-Module|\.)\s+['"]?([^'"\s]+)/i],
  },
  text: { id: "text", rules: [], imports: [] },
  markdown: {
    id: "markdown",
    rules: [{ pattern: /^#{1,4}\s+(.+?)\s*#*\s*$/, kind: "module" }],
    imports: [],
  },
}

const EXTENSIONS: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript", js: "typescript", jsx: "typescript",
  mjs: "typescript", cjs: "typescript", vue: "typescript", svelte: "typescript", astro: "typescript",
  py: "python", pyi: "python", go: "go", rs: "rust",
  java: "java", kt: "java", kts: "java", scala: "java", cs: "java", groovy: "java", dart: "java",
  c: "c", h: "c", cc: "c", cpp: "c", cxx: "c", hpp: "c", hh: "c", hxx: "c", m: "c", mm: "c", cu: "c",
  php: "php", rb: "ruby", rake: "ruby", swift: "swift", lua: "lua",
  sh: "shell", bash: "shell", zsh: "shell", fish: "shell", ps1: "powershell", psm1: "powershell",
  md: "markdown", mdx: "markdown",
  json: "text", jsonc: "text", yaml: "text", yml: "text", toml: "text", ini: "text", xml: "text", html: "text",
  htm: "text", css: "text", scss: "text", less: "text", sql: "text", graphql: "text", gql: "text", proto: "text",
  txt: "text", gradle: "text", tf: "text", hcl: "text", nix: "text", ex: "text", exs: "text", erl: "text",
  hs: "text", ml: "text", clj: "text", r: "text", jl: "text", zig: "text", nim: "text", sol: "text", smali: "text",
}

const NAMES: Record<string, string> = {
  dockerfile: "text", makefile: "text", gemfile: "ruby", rakefile: "ruby", "cmakelists.txt": "text", justfile: "text",
}

/** The language of a file, or undefined for a file the index skips. */
export function detect(file: string): string | undefined {
  const base = file.slice(file.lastIndexOf("/") + 1).toLowerCase()
  if (NAMES[base]) return NAMES[base]
  const dot = base.lastIndexOf(".")
  if (dot <= 0) return undefined
  return EXTENSIONS[base.slice(dot + 1)]
}

/** The symbols a file declares, in line order (1-based lines). */
export function declarations(language: string, lines: readonly string[]): Declaration[] {
  const spec = LANGUAGES[language]
  if (!spec?.rules.length) return []
  const found: Declaration[] = []
  let fence = false

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (language === "markdown" && /^\s*(```|~~~)/.test(line)) fence = !fence
    if (fence || line.length > 400 || (spec.comment && spec.comment.test(line))) continue

    for (const rule of spec.rules) {
      const match = rule.pattern.exec(line)
      if (!match) continue
      const name = match[rule.name ?? 1]?.trim()
      if (!name || KEYWORDS.has(name) || name.length > 120) continue
      const kind = typeof rule.kind === "function" ? rule.kind(match) : rule.kind
      found.push({ name, kind, line: index + 1, indent: line.length - line.trimStart().length })
      break
    }
  }
  return found
}

const BRACES = new Set(["typescript", "go", "rust", "java", "c", "php", "swift"])
const INDENTED = new Set(["python"])

/** How braces change the nesting on one line, skipping strings and line comments; `quote` carries a template string. */
function braceDelta(line: string, state: { quote: string }) {
  // Block-comment lines often hold quotes and backticks that open nothing.
  if (!state.quote && /^\s*(\/\*|\*)/.test(line)) return 0
  let delta = 0
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!
    if (state.quote) {
      if (char === "\\") index++
      else if (char === state.quote) state.quote = ""
      continue
    }
    if (char === "/" && line[index + 1] === "/") break
    if (char === '"' || char === "'" || char === "`") state.quote = char
    else if (char === "{") delta++
    else if (char === "}") delta--
  }
  // Only template strings run on to the next line.
  if (state.quote && state.quote !== "`") state.quote = ""
  return delta
}

/**
 * A declaration's last line (1-based): its closing brace in brace languages, its last indented line in Python, else up
 * to the next declaration at the same or an outer level.
 */
export function endOf(language: string, lines: readonly string[], declarations: readonly Declaration[], index: number) {
  const item = declarations[index]!
  const next = declarations.slice(index + 1).find((other) => other.indent <= item.indent)
  const fallback = Math.max(item.line, next ? next.line - 1 : lines.length)

  if (BRACES.has(language)) {
    const state = { quote: "" }
    let depth = 0
    let opened = false
    const first = item.line - 1
    for (let position = first; position < lines.length; position++) {
      // A body opens on the declaration's line or just after it; otherwise it has none.
      if (!opened && position - first >= 3) return fallback
      const line = lines[position]!
      depth += braceDelta(line, state)
      if (depth > 0) opened = true
      if (opened && depth <= 0) return position + 1
      if (opened) continue
      // No body: a type alias, an abstract method, a one-line arrow function. It ends where its statement does.
      if (/;\s*$/.test(line)) return position + 1
      if (position === first && !/[({[,=<>:|&?+\-*/]\s*$/.test(line)) return position + 1
    }
    return fallback
  }

  if (INDENTED.has(language)) {
    let last = item.line
    for (let position = item.line; position < lines.length; position++) {
      const line = lines[position]!
      if (!line.trim()) continue
      if (line.length - line.trimStart().length <= item.indent) break
      last = position + 1
    }
    return last
  }

  return fallback
}

/** The modules a file imports, as written. */
export function imports(language: string, lines: readonly string[]): string[] {
  const spec = LANGUAGES[language]
  if (!spec?.imports.length) return []
  const found = new Set<string>()
  let goBlock = false

  for (const line of lines) {
    if (spec.comment && spec.comment.test(line)) continue
    if (language === "go") {
      if (/^\s*import\s*\(/.test(line)) goBlock = true
      else if (goBlock && /^\s*\)/.test(line)) goBlock = false
      if (!goBlock && /^\s+/.test(line) && !/^\s*import/.test(line)) continue
    }
    for (const pattern of spec.imports) {
      const match = pattern.exec(line)
      if (match?.[1]) found.add(match[1])
    }
  }
  return [...found]
}
