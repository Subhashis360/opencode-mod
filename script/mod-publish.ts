#!/usr/bin/env bun
// Builds the history OpenCode Mod publishes on GitHub: one commit importing upstream OpenCode,
// followed by the mod's own commits. The full upstream history stays on the local `opencode-mod`
// branch, which is where upstream merges happen, so this branch can always be regenerated.
//
//   bun script/mod-publish.ts --init <upstream-commit>   start mod-public from that upstream commit
//   bun script/mod-publish.ts                            append opencode-mod commits made since
//
// Then publish with: git push mod mod-public:main
import { $ } from "bun"

const SOURCE = "opencode-mod"
const PUBLIC = "mod-public"
// The opencode-mod commit the public branch was last brought up to date with.
const MARKER = "refs/mod/published-source"

const git = async (...args: string[]) => (await $`git ${args}`.quiet().text()).trim()

async function upstreamVersion(commit: string) {
  return JSON.parse(await git("show", `${commit}:packages/opencode/package.json`)).version as string
}

// Creates a commit with the given tree. Without an author it uses this repo's git identity.
async function commitTree(input: {
  tree: string
  parent?: string
  message: string
  author?: { name: string; email: string; date: string }
}) {
  const env = {
    ...process.env,
    ...(input.author
      ? { GIT_AUTHOR_NAME: input.author.name, GIT_AUTHOR_EMAIL: input.author.email, GIT_AUTHOR_DATE: input.author.date }
      : {}),
  }
  const parents = input.parent ? ["-p", input.parent] : []
  return (
    await $`git commit-tree ${input.tree} ${parents} -F - < ${Buffer.from(input.message)}`.env(env).quiet().text()
  ).trim()
}

// Copies each first-parent commit after `from` onto `head`. Ordinary commits keep their
// message and author; an upstream merge becomes one "Sync with OpenCode x.y.z" commit.
async function replay(from: string, head: string) {
  const commits = (await git("rev-list", "--reverse", "--first-parent", `${from}..${SOURCE}`))
    .split("\n")
    .filter(Boolean)
  for (const commit of commits) {
    const tree = await git("rev-parse", `${commit}^{tree}`)
    const parents = (await git("rev-list", "--parents", "-n", "1", commit)).split(" ").length - 1
    if (parents > 1) {
      const version = await upstreamVersion(commit)
      head = await commitTree({
        tree,
        parent: head,
        message: `Sync with OpenCode ${version}\n\nMerges upstream anomalyco/opencode up to ${commit.slice(0, 10)}.\n`,
      })
      continue
    }
    const [name, email, date] = (await git("log", "-1", "--format=%an%x00%ae%x00%aI", commit)).split("\0")
    const message = await git("log", "-1", "--format=%B", commit)
    head = await commitTree({ tree, parent: head, message: `${message}\n`, author: { name, email, date } })
  }
  return head
}

const initAt = process.argv.indexOf("--init")
let head: string
if (initAt !== -1) {
  const base = process.argv[initAt + 1]
  if (!base) throw new Error("--init needs the upstream commit the mod is based on")
  const upstream = await git("rev-parse", `${base}^{commit}`)
  const version = await upstreamVersion(upstream)
  head = await commitTree({
    tree: await git("rev-parse", `${upstream}^{tree}`),
    message: [
      `Import OpenCode ${version}`,
      "",
      `Source: https://github.com/anomalyco/opencode at ${upstream}.`,
      "OpenCode is MIT licensed; see LICENSE. Its full history is kept in the upstream repository.",
      "",
    ].join("\n"),
  })
  head = await replay(upstream, head)
} else {
  head = await replay(await git("rev-parse", MARKER), await git("rev-parse", PUBLIC))
}

// The published branch must contain exactly the same files as opencode-mod.
if ((await git("rev-parse", `${head}^{tree}`)) !== (await git("rev-parse", `${SOURCE}^{tree}`)))
  throw new Error(`${PUBLIC} does not match ${SOURCE}; nothing was updated`)

await git("update-ref", `refs/heads/${PUBLIC}`, head)
await git("update-ref", MARKER, await git("rev-parse", SOURCE))
console.log(`${PUBLIC} is now ${head.slice(0, 10)} (${await git("rev-list", "--count", PUBLIC)} commits)`)
