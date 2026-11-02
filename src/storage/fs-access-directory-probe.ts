/** Read one entry to establish that a selected directory still resolves. */
export async function probeDirectory(
  directory: FileSystemDirectoryHandle
): Promise<void> {
  if (typeof directory.entries === "function") {
    await directory.entries().next()
  } else if (typeof directory.values === "function") {
    await directory.values().next()
  }
}
