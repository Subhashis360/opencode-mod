import { gui } from "@opencode/plugin/gui/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [gui({ entry: "src/gui.tsx" })],
  // A library build keeps process.env.NODE_ENV, which bundled dependencies read; windows have no `process`.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
})
