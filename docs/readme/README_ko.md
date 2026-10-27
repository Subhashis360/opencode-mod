<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [日本語](README_ja.md) · **한국어** · [हिन्दी](README_hi.md)
# OpenCode Mod: OpenCode 확장 프로그램

### OpenCode Desktop에 컴퓨터 사용, 공급자 편집기, 바로 쓰는 에이전트, 자동화를 더하는 플러그인.

**OpenCode 에이전트가 내 컴퓨터와 원하는 모델 공급자를 사용하고, 예약된 시간에 실행됩니다.**

<code>git clone https://github.com/Subhashis360/opencode-mod.git</code>

</div>

> [!IMPORTANT]
> OpenCode Mod는 [Subhashis360/opencode-mod](https://github.com/Subhashis360/opencode-mod)에서만 받으세요. 비공식 커뮤니티 확장이며 OpenCode 팀이 만든 것이 아닙니다. 예전 독립형 "OpenCode Mod" 앱은 지원이 종료되었습니다.

<img src="../../assets/hero.png" alt="OpenCode 확장 프로그램 OpenCode Mod: OpenCode Desktop의 설정 → Mod 페이지" width="1200" />

## 빠른 시작

[OpenCode Desktop](https://opencode.ai) **2.2 이상**과 [Git](https://git-scm.com)이 필요합니다. 컴퓨터 사용은 Windows 전용이며, 나머지 기능은 Windows, macOS, Linux에서 동작합니다. 빌드된 파일이 포함되어 있어 컴파일이 필요 없습니다.

### 에이전트에게 설치 맡기기

컴퓨터에서 명령을 실행할 수 있는 코딩 에이전트(OpenCode, Claude Code, Codex, Cursor, Gemini CLI 등)에 아래 프롬프트를 그대로 붙여 넣으세요. 영어 그대로 두면 됩니다:

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

### 직접 설치

저장소를 클론한 뒤 전역 설정 `~/.config/opencode/opencode.json`의 `plugins`에 폴더 경로를 추가합니다(Windows에서도 슬래시 사용):

```jsonc
{ "plugins": ["C:/Users/<you>/opencode-mod"] }
```

OpenCode Desktop을 다시 시작하고 **설정 → Mod**를 열거나 `Ctrl+Shift+P`를 누르고 **Mod**를 입력하세요.

## 기능

- **사용자 지정 공급자 편집과 모델 가져오기**: Base URL, API 키, 헤더를 수정하고 공급자 API에서 모델 목록을 가져와 선택(OpenRouter, Ollama, LM Studio, NVIDIA NIM 등).
- **컴퓨터 사용**: 에이전트가 Windows 앱과 Android 휴대폰을 조작합니다. 앱마다 처음에 승인이 필요하며, 스크린샷은 읽은 즉시 삭제됩니다.
- **에이전트 템플릿**: Security Auditor, Bug Bounty Assistant(모의 해킹·버그 바운티), Code Reviewer, Debugger 등.
- **속도 설정**: Parallel 웹 검색(Exa, Tavily도 선택 가능), 세션 캐시 유지, 백그라운드 압축 등.
- **자동화**: 예약 작업, 훅, 자동 메모리, MCP 서버, 권한 프리셋, 시스템 프롬프트 편집.

자세한 내용, 스크린샷, FAQ는 [English README](../../README.md)를 참고하세요.
