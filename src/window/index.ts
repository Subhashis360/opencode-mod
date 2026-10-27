import { Plugin } from "@opencode/plugin/gui"
import en from "./i18n/en"

// OpenCode Mod's GUI declarations: its copy. The settings pages talk to the server part over its RPC.
export default Plugin.define({
  i18n: { en },
})
