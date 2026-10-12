import { $ } from "bun"
import { buildServerBundle, downloadCliToResources } from "./utils"

await $`bun run install-electron`

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

await buildServerBundle()
await downloadCliToResources()
