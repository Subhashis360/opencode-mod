import { describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Exit } from "effect"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { ComputerTool } from "../../src/tool/computer"
import { ComputerDriver } from "../../src/computer/driver"
import { SessionID, MessageID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Truncate.node, Agent.node])))
// Each test boots a temporary instance and the first one also starts the helper.
const TIMEOUT = 30_000

const asked: (readonly string[])[] = []
const context = (ask: Tool.Context["ask"] = (input) => Effect.sync(() => void asked.push(input.patterns))) => ({
  sessionID: SessionID.make("ses_computer"),
  messageID: MessageID.make("msg_computer"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask,
})

const exec = Effect.fn("ComputerToolTest.exec")(function* (
  args: Tool.InferParameters<typeof ComputerTool>,
  ctx = context(),
) {
  const info = yield* ComputerTool
  const tool = yield* info.init()
  return yield* tool.execute(args, ctx)
})

// These drive the real desktop helper, so they only run where it is supported.
describe.skipIf(!ComputerDriver.supported())("tool.computer", () => {
  it.instance(
    "takes a scaled jpeg screenshot after asking to view the screen",
    () =>
      Effect.gen(function* () {
        asked.length = 0
        const result = yield* exec({ action: "screenshot" })
        expect(result.output).toMatch(/^display 0 \d+x\d+$/)
        expect(result.attachments?.[0].mime).toBe("image/jpeg")
        expect(result.attachments?.[0].url.startsWith("data:image/jpeg;base64,")).toBe(true)
        const [, width, height] = result.output.match(/(\d+)x(\d+)/)!.map(Number)
        expect(Math.max(width, height)).toBeLessThanOrEqual(1280)
        expect(asked).toEqual([["screen"]])
      }),
    TIMEOUT,
  )

  it.instance(
    "lists displays with their screenshot frames",
    () =>
      Effect.gen(function* () {
        const result = yield* exec({ action: "list_displays" })
        expect(result.output).toMatch(/^0: \d+x\d+ primary -> frame \d+x\d+/)
        expect(result.attachments).toBeUndefined()
      }),
    TIMEOUT,
  )

  it.instance(
    "reads the focused window as text",
    () =>
      Effect.gen(function* () {
        const result = yield* exec({ action: "read_window" })
        expect(result.output).toMatch(/on display \d+:|no readable elements/)
      }),
    TIMEOUT,
  )

  it.instance(
    "batches steps and attaches a screenshot at the end",
    () =>
      Effect.gen(function* () {
        const result = yield* exec({
          action: "cursor_position",
          actions: [{ action: "wait", duration: 0 }],
          screenshot_after: true,
        })
        expect(result.output.split("\n")).toHaveLength(3)
        expect(result.output).toContain("2. waited 0s")
        expect(result.attachments).toHaveLength(1)
      }),
    TIMEOUT,
  )

  it.instance(
    "attaches a screenshot after a screen-changing action unless told not to",
    () =>
      Effect.gen(function* () {
        asked.length = 0
        const auto = yield* exec({ action: "wait", duration: 0 })
        expect(auto.attachments).toHaveLength(1)
        expect(asked).toEqual([["screen"]])
        const skipped = yield* exec({ action: "wait", duration: 0, screenshot_after: false })
        expect(skipped.attachments).toBeUndefined()
        const reading = yield* exec({ action: "cursor_position" })
        expect(reading.attachments).toBeUndefined()
      }),
    TIMEOUT,
  )

  it.instance(
    "rejects malformed coordinates",
    () =>
      Effect.gen(function* () {
        const exit = yield* exec({ action: "mouse_move", coordinate: [1] }).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        expect(String(exit)).toContain("coordinate must be [x, y]")
      }),
    TIMEOUT,
  )

  it.instance(
    "stops when the user denies the screen permission",
    () =>
      Effect.gen(function* () {
        const denied = new Error("permission denied")
        const exit = yield* exec(
          { action: "screenshot" },
          context(() => Effect.die(denied)),
        ).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        expect(String(exit)).toContain("permission denied")
      }),
    TIMEOUT,
  )
})
