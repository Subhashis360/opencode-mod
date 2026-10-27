<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · **日本語** · [한국어](README_ko.md) · [हिन्दी](README_hi.md)
# OpenCode Mod：OpenCode 拡張機能

### OpenCode Desktop にコンピューター操作、プロバイダー編集、すぐ使えるエージェント、自動化を追加するプラグイン。

**OpenCode のエージェントが、あなたの PC と好きなモデルプロバイダーを使い、スケジュールで動きます。**

<code>git clone https://github.com/Subhashis360/opencode-mod.git</code>

</div>

> [!IMPORTANT]
> OpenCode Mod は [Subhashis360/opencode-mod](https://github.com/Subhashis360/opencode-mod) からのみ入手してください。非公式のコミュニティ拡張で、OpenCode チームの製品ではありません。旧スタンドアロン版 "OpenCode Mod" アプリは提供終了です。

<img src="../../assets/hero.png" alt="OpenCode 拡張機能 OpenCode Mod：OpenCode Desktop の 設定 → Mod ページ" width="1200" />

## クイックスタート

[OpenCode Desktop](https://opencode.ai) **2.2 以降** と [Git](https://git-scm.com) が必要です。コンピューター操作は Windows のみ、その他の機能は Windows・macOS・Linux で動作します。ビルド済みファイルが含まれているのでコンパイルは不要です。

### エージェントに任せてインストール

PC 上でコマンドを実行できるコーディングエージェント（OpenCode、Claude Code、Codex、Cursor、Gemini CLI など）に、次のプロンプトをそのまま貼り付けてください（英語のままで問題ありません）：

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

### 手動インストール

リポジトリをクローンし、グローバル設定 `~/.config/opencode/opencode.json` の `plugins` にフォルダーのパスを追加します（Windows でもスラッシュ区切り）：

```jsonc
{ "plugins": ["C:/Users/<you>/opencode-mod"] }
```

OpenCode Desktop を再起動し、**設定 → Mod** を開くか、`Ctrl+Shift+P` で **Mod** と入力します。

## 主な機能

- **カスタムプロバイダーの編集とモデル取得**：Base URL・API キー・ヘッダーを編集し、プロバイダーの API からモデル一覧を取得して選択（OpenRouter、Ollama、LM Studio、NVIDIA NIM など）。
- **コンピューター操作**：エージェントが Windows アプリや Android スマホを操作。アプリごとに初回承認が必要で、スクリーンショットは読み取り後すぐ削除。
- **エージェントテンプレート**：Security Auditor、Bug Bounty Assistant（ペネトレーションテスト・バグバウンティ向け）、Code Reviewer、Debugger など。
- **高速化設定**：Parallel ウェブ検索（Exa、Tavily も選択可）、セッションのウォーム維持、バックグラウンド圧縮など。
- **自動化**：スケジュール実行、フック、自動メモリー、MCP サーバー、権限プリセット、システムプロンプト編集。

詳細・スクリーンショット・FAQ は [English README](../../README.md) をご覧ください。
