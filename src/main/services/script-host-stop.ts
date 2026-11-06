export function armHostStop(input: {
  postAbort: () => void
  kill: () => void
  hasExited: () => boolean
  schedule: (fn: () => void, ms: number) => { cancel: () => void }
  graceMs?: number
}): { cancel: () => void } {
  input.postAbort()
  return input.schedule(() => {
    if (!input.hasExited()) input.kill()
  }, input.graceMs ?? 1000)
}
