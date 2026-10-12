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

**Improvements**

- Connected custom providers can be edited, and removing a model or header from one now persists.
- Fixed "OpenCode 1.18.0 or newer is required to use the free tier" on builds made from source.
