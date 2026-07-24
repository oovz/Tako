export function reconcileOptionsSave<T>(input: {
  submitted: T
  persisted?: T
  submittedRevision: number
  currentRevision: number
}): {
  saved: T
  clearTransientDraft: boolean
  hasUnsavedChanges: boolean
} {
  const draftUnchanged = input.currentRevision === input.submittedRevision
  return {
    saved: input.persisted ?? input.submitted,
    clearTransientDraft: draftUnchanged,
    hasUnsavedChanges: !draftUnchanged,
  }
}
