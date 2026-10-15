// Which models the picker shows before the user shows or hides any by hand.
//
// The newest model of each family released in the last six months, plus every OpenCode free
// model. Free models are the whole point of using OpenCode without a key, and the catalog gives
// many of them no family (or one shared with an older free model), so the family rule alone
// hid most of them.

// luxon's diffNow().as("months") used an average month; keep the same window.
const SIX_MONTHS = 6 * 30.436875 * 24 * 60 * 60 * 1000

export type Candidate = {
  id: string
  family?: string
  release_date: string
  provider: { id: string }
  cost?: { input: number; output: number }
}

export function modelKey(model: { providerID: string; modelID: string }) {
  return `${model.providerID}:${model.modelID}`
}

export function isFree(model: Candidate) {
  return model.provider.id === "opencode" && model.cost?.input === 0 && model.cost?.output === 0
}

export function defaultVisible(models: Candidate[], now: number) {
  const newest = new Map<string, Candidate>()
  for (const model of models) {
    const released = Date.parse(model.release_date)
    if (!(Math.abs(now - released) < SIX_MONTHS)) continue
    // A model with no family is its own family; grouping them together would keep only one.
    const group = `${model.provider.id}:${model.family || `#${model.id}`}`
    const current = newest.get(group)
    if (!current || model.release_date > current.release_date) newest.set(group, model)
  }
  const keys = new Set<string>()
  for (const model of newest.values()) keys.add(modelKey({ providerID: model.provider.id, modelID: model.id }))
  for (const model of models)
    if (isFree(model)) keys.add(modelKey({ providerID: model.provider.id, modelID: model.id }))
  return keys
}
