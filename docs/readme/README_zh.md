<div align="center">

[English](../../README.md) · **简体中文** · [日本語](README_ja.md) · [한국어](README_ko.md) · [हिन्दी](README_hi.md)
# OpenCode Mod：OpenCode 扩展

### 一个插件，为 OpenCode Desktop 带来电脑操控（computer use）、供应商编辑器、现成的智能体和自动化。

**让你的 OpenCode 智能体使用你的电脑、任意模型供应商，并按计划自动运行。**

<code>git clone https://github.com/Subhashis360/opencode-mod.git</code>

</div>

> [!IMPORTANT]
> 请只从 [Subhashis360/opencode-mod](https://github.com/Subhashis360/opencode-mod) 获取 OpenCode Mod。这是非官方社区扩展，并非 OpenCode 团队出品。旧的独立版 "OpenCode Mod" 桌面应用已停止维护。

<img src="../../assets/hero.png" alt="OpenCode 扩展 OpenCode Mod：OpenCode Desktop 中的 设置 → Mod 页面" width="1200" />

## 快速开始

需要 [OpenCode Desktop](https://opencode.ai) **2.2 或更高版本** 和 [Git](https://git-scm.com)。电脑操控需要 Windows，其他功能支持 Windows、macOS 和 Linux。仓库已包含构建好的文件，无需编译。

### 一句话安装（交给你的智能体）

把下面这段提示词粘贴到任何能在你电脑上执行命令的编程智能体（OpenCode、Claude Code、Codex、Cursor、Gemini CLI 等）。提示词保持英文，智能体可以直接理解：

```text
Install the OpenCode Mod extension for OpenCode Desktop from https://github.com/Subhashis360/opencode-mod

1. Check that git is installed. Clone the repository into a permanent folder in my home directory
   (for example ~/opencode-mod). If that folder already exists and is this repository, run `git pull` in it instead.
2. Open my global OpenCode config: ~/.config/opencode/opencode.json
   (on Windows: C:\Users\<me>\.config\opencode\opencode.json). Create the file with {} if it does not exist.
3. Add the absolute path of the cloned folder, written with forward slashes, to the "plugins" array
   (create the array if it is missing). Keep every other setting and every existing plugin exactly as it is,
   keep the file valid JSON/JSONC, and do not add the path twice.
4. Do not change anything else. Do not run npm install: the built files are already in the repository.
5. Show me the "plugins" line you wrote, then tell me to restart OpenCode Desktop (2.2 or newer)
   and open Settings → Mod, or press Ctrl+Shift+P and type "Mod".
```

### 手动安装

克隆仓库，然后把文件夹路径加入全局配置 `~/.config/opencode/opencode.json` 的 `plugins`（Windows 下也使用正斜杠）：

```jsonc
{ "plugins": ["C:/Users/<you>/opencode-mod"] }
```

重启 OpenCode Desktop，打开 **设置 → Mod**，或按 `Ctrl+Shift+P` 输入 **Mod**。

## 功能

- **编辑自定义供应商并拉取模型列表**：修改 Base URL、API Key、请求头，从供应商 API 一键获取模型并勾选（支持 OpenRouter、Ollama、LM Studio、NVIDIA NIM 等）。
- **电脑操控**：智能体可以打开并操作 Windows 应用和 Android 手机，每个应用首次使用都需要你批准；截图读取后立即删除。
- **现成的智能体模板**：安全审计（Security Auditor）、漏洞赏金助手（Bug Bounty Assistant）、代码审查、调试、测试编写等。
- **提速设置**：Parallel 网络搜索（也可选 Exa、Tavily）、保持会话缓存预热、后台压缩等。
- **自动化**：定时任务、Hooks、自动记忆、MCP 服务器、权限预设、系统提示词编辑。

更多说明、截图和常见问题请查看 [English README](../../README.md)。
