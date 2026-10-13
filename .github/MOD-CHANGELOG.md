# OpenCode Mod changelog

Each section is named after the upstream OpenCode version the mod release is based on. The release script publishes the matching section as the release notes.

## 1.18.29

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
