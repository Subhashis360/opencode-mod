# OpenCode Mod

An unofficial, community-modified build of the [OpenCode](https://github.com/anomalyco/opencode) desktop app. It adds a set of power-user settings on top of the upstream app and installs **next to** the official OpenCode instead of replacing it.

> Not affiliated with or endorsed by the OpenCode team. All upstream code is MIT licensed; see [LICENSE](../LICENSE).

## Install

1. Download `opencode-mod-win-x64.exe` from the [latest release](https://github.com/Subhashis360/opencode-mod/releases/latest).
2. Run it. You can choose the install folder, and you get a **OpenCode Mod** desktop and Start menu shortcut.

The mod is a separate app. It has its own install folder, app data, Windows app id, and `opencode-mod://` links, so the official OpenCode keeps working and updating on its own.

### Updates

OpenCode Mod checks this repository for new releases every 10 minutes and from **Settings → General → Check for updates**. When an update is ready it asks before restarting to install it.

### Shared configuration

Both apps (and the `opencode` CLI) read the same OpenCode configuration in `~/.config/opencode`. Agents, permissions, MCP servers and commands you set up in the mod also apply to the official app and the CLI.

## What the mod adds

All of these live in **Settings**, under the new **Mod** section, except provider editing.

### Edit custom providers

Connected custom (OpenAI-compatible) providers get an **Edit** button. The form opens with the saved name, base URL, models and headers; the provider ID stays locked so the entry is updated instead of duplicated. Removing a model or header now really removes it. Stored API keys are write-only, so the key field starts empty and only replaces the saved key when you type a new one.

### Agents

Create, edit, enable/disable and delete custom agents: name, mode (primary, subagent or both), model, system prompt, temperature, max steps, color, and per-agent limits for editing files, running commands and fetching web pages.

Templates to start from: **Security Auditor**, **Bug Bounty Assistant**, **Code Reviewer**, **Debugger**, **Test Writer**, **Architect** and **Docs Writer**. A template only fills the form; nothing is saved until you click Save.

### Permissions

One-click presets:

| Preset          | Behaviour                                                                               |
| --------------- | --------------------------------------------------------------------------------------- |
| Read-only audit | Read and search only; editing, shell commands and files outside the project are blocked |
| Safe            | Reading is automatic; edits, commands and web pages ask first                           |
| Balanced        | Everything is automatic except shell commands and files outside the project             |
| Full auto       | Never asks (use in a sandbox or a project you can restore)                              |

Each tool can also be set to Allow, Ask, Deny or Default individually.

### MCP servers

Add local (command) or remote (URL) MCP servers with environment variables or headers and a timeout; edit, enable/disable or delete them. Templates: Playwright, Context7, GitHub, Filesystem and Sequential Thinking.

### Commands

Reusable `/name` prompts with `$ARGUMENTS`, `` !`shell command` `` output and `@file` attachments, an optional agent and model, and an option to run as a subtask. Templates: `/review`, `/audit`, `/tests`, `/explain`, `/commit` and `/fix`.

### Free tier fix

A build made from source used to report itself as version `0.0.0-<branch>`, which OpenCode's free tier rejects with _"OpenCode 1.18.0 or newer is required to use the free tier"_. The build now stamps the real upstream version it is based on, and refuses to build if that version is too old.

## Build from source

Requirements: [Bun](https://bun.sh) (the version in the root `package.json`), Git, Windows 10/11.

```bash
bun install --ignore-scripts
bun run --cwd packages/desktop package:mod
```

The installer is written to `packages/desktop/dist/`.

`--ignore-scripts` skips a native module (`tree-sitter-powershell`) that needs Visual Studio build tools and is not used by the desktop app.

## Release a new version

Needs the [GitHub CLI](https://cli.github.com) logged in with access to this repository.

1. Add a `## <upstream version>` section to [MOD-CHANGELOG.md](MOD-CHANGELOG.md) if there is none.
2. Run:

```bash
bun run --cwd packages/desktop release:mod
```

This builds the installer and publishes it as a GitHub release, and installed copies pick it up automatically.

Mod versions are `major.minor.(patch × 100 + revision)`: `1.18.2900` is upstream 1.18.29 with mod revision 0, the next mod-only release is `1.18.2901`, and upstream 1.18.30 becomes `1.18.3000`. The release script picks the next free revision on its own.

## Stay up to date with upstream

```bash
git remote add upstream https://github.com/anomalyco/opencode.git
git fetch upstream
git merge upstream/dev
```

Resolve any conflicts, run the tests, and release. The mod's changes are kept in a small, separate set of files (listed below) so upstream merges stay easy, and syncing also picks up any new minimum version the free tier asks for.

| Area                  | Files                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Mod settings tabs     | `packages/app/src/components/settings-v2/mod/`                                                                               |
| Mod strings           | `packages/app/src/i18n/mod.ts`                                                                                               |
| Provider editing      | `packages/app/src/components/dialog-custom-provider*.ts(x)`, `settings-providers.tsx`, `settings-v2/providers.tsx`           |
| Config entry removal  | `packages/opencode/src/config/config.ts`, `packages/opencode/src/server/routes/instance/httpapi/{groups,handlers}/global.ts` |
| Separate app identity | `packages/desktop/electron-builder.config.ts`, `packages/desktop/src/main/{constants,index,migrate}.ts`                      |
| Build and release     | `packages/desktop/scripts/{mod,utils,prebuild,predev}.ts`                                                                    |
