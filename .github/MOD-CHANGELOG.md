# OpenCode Mod changelog

Each section is named after the upstream OpenCode version the mod release is based on. The release script publishes the matching section as the release notes.

## 1.18.29

### 1.18.2906

**Computer use (Experimental, Windows).** The agent can open apps, read windows, click, type and check its own work in your desktop apps, with the free models. It reads windows as text through UI Automation first, so it often needs no screenshot. `click_element` presses buttons and ticks boxes through accessibility without moving your mouse. You approve each app the first time; terminals and IDEs only get plain clicks. Turn it on in Settings → Mod → Experimental.

**New in Settings → Mod**

- **Scheduled**: prompts that run once, every N minutes, daily, weekly, monthly or on a cron, each in a new session. Run now, pause, edit, history, missed-run catch-up and a per-task approval mode. The agent can schedule tasks too ("every weekday at 9, summarise new issues").
- **Hooks**: your own shell commands on agent events (before and after tool calls, on prompt, when the agent goes idle, on permission requests and errors). Exit code 2 blocks the tool call. Templates and a test button included.
- **Memory**: the agent saves facts about you and your projects and starts each new session with the relevant ones. View, edit and switch it off.
- **Experimental**: Computer use and Plan mode switches. Plan mode's approve-the-plan step now works in the desktop app.

**Faster**

- Messages you send while the agent is working reach it on its next step instead of waiting for the run to end.
- Long commands can run in the background and wake the agent when they finish or print what it is waiting for; a `jobs` tool lists, reads and stops them.
- Computer use returns a screenshot with each screen-changing action, saving a model turn each time, and types about twice as fast.

**Desktop**

- Keep running in the tray when closed, start at Windows sign-in, and native notifications for finished runs and approvals.

**Fixes**

- The model picker shows every OpenCode free model (some were hidden) and refreshes the catalog each time it opens.
- Commands that start a background process (dev servers, `start /b`) no longer hang until the timeout.

### 1.18.2900

First release of OpenCode Mod, based on OpenCode 1.18.29.

**Installs beside the official app.** OpenCode Mod has its own install folder, app data, shortcuts and `opencode-mod://` links, and updates itself from this repository.

**New in Settings → Mod**

- **Agents**: create, edit, enable/disable and delete custom agents with their own prompt, model, temperature, step limit, color and tool limits. Includes templates such as Security Auditor, Bug Bounty Assistant, Code Reviewer and Debugger.
- **Permissions**: Read-only audit, Safe, Balanced and Full auto presets, plus Allow/Ask/Deny per tool.
- **MCP Servers**: add, edit, toggle and delete local or remote MCP servers, with Playwright, Context7, GitHub, Filesystem and Sequential Thinking templates.
- **Commands**: custom `/name` prompts with `$ARGUMENTS`, shell output and file attachments.
- **OpenCode Account**: sign in to your OpenCode account from the app, stay signed in to several accounts, switch between accounts and orgs without signing out, and sign out of any of them.
- **Session limits**: free-tier usage today and over the last 7 days, the public IP it is counted against, time until reset, and an estimated limit and remainder.
- **System prompt**: see, edit and reset each agent's system prompt, start from built-in or GitHub's latest prompts, and keep a library of your own.
- **Experimental**: switch on engine features upstream leaves off (code mode, background subagents, LSP tool, Exa/Parallel web search, alpha models, native LLM client and more), and raise the shell timeout and output token limit.

**Unlocked**

- Features upstream only enables in dev and beta builds, such as the workspace bar on new sessions, are on.

**Improvements**

- Settings stays open while you work: outside clicks and Escape no longer close it, and it has a close button.
- The OpenCode Account tab explains what chats use when no account is signed in (free models or your providers).
- Connected custom providers can be edited, and removing a model or header from one now persists.
- Fixed "OpenCode 1.18.0 or newer is required to use the free tier" on builds made from source.
