#!/usr/bin/env bun
import { $ } from "bun"

import { buildServerBundle, downloadCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

await buildServerBundle()
if (channel === "dev") await downloadCliToResources()
