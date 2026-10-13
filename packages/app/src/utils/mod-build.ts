// OpenCode Mod builds report the prod channel (so updates, telemetry opt-outs and defaults match a
// release) but still unlock the features upstream only ships in dev and beta builds.
export const isModBuild = import.meta.env.VITE_OPENCODE_MOD === "1"
export const prereleaseFeatures = isModBuild || import.meta.env.VITE_OPENCODE_CHANNEL !== "prod"
