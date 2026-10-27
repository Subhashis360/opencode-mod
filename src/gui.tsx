import { Plugin } from "@opencode/plugin/gui"
import main from "./main"
import definition from "./window/index"
import setup from "./window/renderer"

// OpenCode Mod's GUI part, the plugin's `./gui-experimental` bundle: the Mod settings pages in every window, and the
// tray and the scheduled-task runner in the desktop app's main process.
export default Plugin.define({ ...definition, setup, main })
