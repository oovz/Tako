export async function runConfirmedHistoryAction(
  action: () => Promise<boolean>,
  onSuccess: () => void
): Promise<boolean> {
  const succeeded = await action()
  if (succeeded) {
    onSuccess()
  }
  return succeeded
}
