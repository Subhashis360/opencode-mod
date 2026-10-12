// Starting points offered by the mod settings tabs. Each one only prefills the editor; nothing is
// saved until the user reviews it and clicks Save.
import type { PermissionAction } from "./entries"

export type AgentTemplate = {
  name: string
  title: string
  description: string
  mode: "primary" | "subagent" | "all"
  temperature?: number
  permission?: Partial<Record<"edit" | "bash" | "webfetch", PermissionAction>>
  prompt: string
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    name: "security-auditor",
    title: "Security Auditor",
    description: "Reviews code for vulnerabilities without changing it",
    mode: "all",
    temperature: 0.1,
    permission: { edit: "deny", bash: "ask", webfetch: "ask" },
    prompt: [
      "You are a senior application security auditor. Review the code you are pointed at for vulnerabilities.",
      "Cover injection (SQL, command, template, LDAP), XSS, SSRF, path traversal, unsafe deserialization,",
      "broken authentication and authorization, IDOR, secrets in code, weak cryptography, race conditions,",
      "insecure defaults and vulnerable dependencies.",
      "Trace untrusted input from its source to every sink before reporting. Do not report issues you cannot",
      "connect to a reachable code path.",
      "For each finding give: title, severity (Critical/High/Medium/Low), file:line, how it is reached,",
      "impact, and a concrete fix. Do not modify files.",
    ].join(" "),
  },
  {
    name: "bug-bounty",
    title: "Bug Bounty Assistant",
    description: "Plans tests and writes reports for authorized security testing",
    mode: "primary",
    temperature: 0.3,
    permission: { bash: "ask", webfetch: "ask" },
    prompt: [
      "You assist with authorized security testing: bug bounty programs, pentests the user is contracted for,",
      "and CTFs. Stay inside the scope and rules the user gives you, and ask for them if they are missing.",
      "Help plan recon, design test cases for the target's features, analyse responses and code, and build",
      "minimal proofs of concept that demonstrate impact without harming data or availability.",
      "Write findings in report format: title, severity with justification, affected asset, steps to",
      "reproduce, impact, and remediation.",
    ].join(" "),
  },
  {
    name: "code-reviewer",
    title: "Code Reviewer",
    description: "Reviews changes for bugs, clarity and maintainability",
    mode: "subagent",
    temperature: 0.1,
    permission: { edit: "deny" },
    prompt: [
      "You review code changes. Look for logic errors, unhandled edge cases, broken error handling, race",
      "conditions, performance problems and unclear naming. Point to file:line for every finding, explain the",
      "failure scenario, and suggest the smallest fix. Skip style nitpicks a formatter would catch.",
    ].join(" "),
  },
  {
    name: "debugger",
    title: "Debugger",
    description: "Finds the root cause of a bug before fixing it",
    mode: "all",
    temperature: 0.2,
    prompt: [
      "You debug problems methodically. Reproduce the issue first, then form hypotheses and test each one",
      "with evidence (logs, a failing test, a minimal script). Fix the root cause rather than the symptom, and",
      "confirm the fix with the same reproduction. Explain what was wrong and why the fix works.",
    ].join(" "),
  },
  {
    name: "test-writer",
    title: "Test Writer",
    description: "Writes focused tests that match the project's conventions",
    mode: "subagent",
    temperature: 0.2,
    prompt: [
      "You write tests. Match the project's existing test framework, file layout and style. Cover the main",
      "behaviour, boundaries and failure cases, one behaviour per test. Run the tests and make sure they pass,",
      "and that they would fail if the behaviour broke.",
    ].join(" "),
  },
  {
    name: "architect",
    title: "Architect",
    description: "Plans changes and explains code without editing it",
    mode: "primary",
    temperature: 0.3,
    permission: { edit: "deny", bash: "deny" },
    prompt: [
      "You plan and explain. Read the relevant code, then describe how it works and propose a step-by-step",
      "plan for the requested change: files to touch, interfaces, risks and how to verify it. Do not edit",
      "files or run commands.",
    ].join(" "),
  },
  {
    name: "docs-writer",
    title: "Docs Writer",
    description: "Writes clear documentation and code comments",
    mode: "subagent",
    temperature: 0.4,
    prompt: [
      "You write documentation. Explain what something does, why it exists and how to use it, with short",
      "runnable examples. Match the tone and structure of the project's existing docs.",
    ].join(" "),
  },
]

export type McpTemplate =
  | {
      name: string
      title: string
      description: string
      type: "local"
      command: string[]
      environment?: Record<string, string>
    }
  | { name: string; title: string; description: string; type: "remote"; url: string; headers?: Record<string, string> }

export const MCP_TEMPLATES: McpTemplate[] = [
  {
    name: "playwright",
    title: "Playwright",
    description: "Browser automation: navigate, click, fill forms, take snapshots",
    type: "local",
    command: ["npx", "@playwright/mcp@latest"],
  },
  {
    name: "context7",
    title: "Context7",
    description: "Up-to-date library documentation and code examples",
    type: "remote",
    url: "https://mcp.context7.com/mcp",
  },
  {
    name: "github",
    title: "GitHub",
    description: "Issues, pull requests and repositories (needs a personal access token)",
    type: "remote",
    url: "https://api.githubcopilot.com/mcp/",
    headers: { Authorization: "Bearer YOUR_GITHUB_TOKEN" },
  },
  {
    name: "filesystem",
    title: "Filesystem",
    description: "Read and write files under a folder you choose",
    type: "local",
    command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
  },
  {
    name: "sequential-thinking",
    title: "Sequential Thinking",
    description: "Structured step-by-step reasoning for hard problems",
    type: "local",
    command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"],
  },
]

export type CommandTemplate = {
  name: string
  description: string
  template: string
  subtask?: boolean
}

export const COMMAND_TEMPLATES: CommandTemplate[] = [
  {
    name: "review",
    description: "Review the uncommitted changes",
    template:
      "Review these uncommitted changes for bugs, security issues and readability. Point to file:line for each finding.\n\n!`git diff`",
  },
  {
    name: "audit",
    description: "Security audit of a file or folder",
    template:
      "Audit $ARGUMENTS for security vulnerabilities. For each finding give severity, file:line, how it is reached, impact and a fix.",
  },
  {
    name: "tests",
    description: "Write tests for a file or function",
    template: "Write tests for $ARGUMENTS using the project's existing test setup, then run them.",
  },
  {
    name: "explain",
    description: "Explain how a piece of code works",
    template: "Explain how $ARGUMENTS works: its purpose, the main flow, and anything surprising.",
    subtask: true,
  },
  {
    name: "commit",
    description: "Write a commit message for the staged changes",
    template:
      "Write a concise commit message (subject line under 72 characters, then a short body) for these staged changes:\n\n!`git diff --staged`",
  },
  {
    name: "fix",
    description: "Find and fix the root cause of a problem",
    template: "Find the root cause of this problem and fix it, then verify the fix: $ARGUMENTS",
  },
]
