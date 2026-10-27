<div align="center">

[English](../../README.md) · [简体中文](README_zh.md) · [日本語](README_ja.md) · [한국어](README_ko.md) · **हिन्दी**
# OpenCode Mod: OpenCode एक्सटेंशन

### एक प्लगइन जो OpenCode Desktop में कंप्यूटर यूज़, प्रोवाइडर एडिटर, तैयार एजेंट और ऑटोमेशन जोड़ता है।

**आपका OpenCode एजेंट अब आपका कंप्यूटर, कोई भी मॉडल प्रोवाइडर और तय समय पर काम चला सकता है।**

<code>git clone https://github.com/Subhashis360/opencode-mod.git</code>

</div>

> [!IMPORTANT]
> OpenCode Mod सिर्फ़ [Subhashis360/opencode-mod](https://github.com/Subhashis360/opencode-mod) से लें। यह एक अनौपचारिक कम्युनिटी एक्सटेंशन है, OpenCode टीम का नहीं। पुराना अलग "OpenCode Mod" डेस्कटॉप ऐप बंद कर दिया गया है।

<img src="../../assets/hero.png" alt="OpenCode एक्सटेंशन OpenCode Mod: OpenCode Desktop में Settings → Mod पेज" width="1200" />

## जल्दी शुरू करें

[OpenCode Desktop](https://opencode.ai) **2.2 या नया** और [Git](https://git-scm.com) चाहिए। कंप्यूटर यूज़ के लिए Windows चाहिए; बाकी सब Windows, macOS और Linux पर चलता है। बनी हुई (built) फ़ाइलें रिपॉज़िटरी में हैं, कुछ कंपाइल नहीं करना।

### एक प्रॉम्प्ट से इंस्टॉल करें

नीचे दिया प्रॉम्प्ट किसी भी कोडिंग एजेंट (OpenCode, Claude Code, Codex, Cursor, Gemini CLI आदि) में पेस्ट करें जो आपके कंप्यूटर पर कमांड चला सकता है। प्रॉम्प्ट अंग्रेज़ी में ही रहने दें:

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

### ख़ुद इंस्टॉल करें

रिपॉज़िटरी क्लोन करें, फिर फ़ोल्डर का पाथ ग्लोबल कॉन्फ़िग `~/.config/opencode/opencode.json` में `plugins` में जोड़ें (Windows पर भी फ़ॉरवर्ड स्लैश):

```jsonc
{ "plugins": ["C:/Users/<you>/opencode-mod"] }
```

OpenCode Desktop दोबारा शुरू करें और **Settings → Mod** खोलें, या `Ctrl+Shift+P` दबाकर **Mod** लिखें।

## फ़ीचर

- **कस्टम प्रोवाइडर एडिट करें और मॉडल लाएँ**: Base URL, API key, हेडर बदलें और प्रोवाइडर की API से मॉडल सूची लाकर चुनें (OpenRouter, Ollama, LM Studio, NVIDIA NIM आदि)।
- **कंप्यूटर यूज़**: एजेंट Windows ऐप और Android फ़ोन चला सकता है; हर ऐप के लिए पहली बार आपकी मंज़ूरी चाहिए, स्क्रीनशॉट पढ़ते ही डिलीट हो जाते हैं।
- **तैयार एजेंट टेम्पलेट**: Security Auditor, Bug Bounty Assistant (पेनटेस्टिंग और बग बाउंटी के लिए), Code Reviewer, Debugger वगैरह।
- **स्पीड सेटिंग्स**: Parallel वेब सर्च (Exa, Tavily भी), सेशन को warm रखना, बैकग्राउंड कॉम्पैक्शन वगैरह।
- **ऑटोमेशन**: शेड्यूल्ड टास्क, हुक्स, ऑटो मेमोरी, MCP सर्वर, परमिशन प्रीसेट, सिस्टम प्रॉम्प्ट एडिटिंग।

पूरी जानकारी, स्क्रीनशॉट और FAQ के लिए [English README](../../README.md) देखें।
