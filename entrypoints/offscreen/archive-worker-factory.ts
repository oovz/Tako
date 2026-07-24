export default function createZipArchiveWorker(): Worker {
  return new Worker(chrome.runtime.getURL("zip-archive-worker.js"))
}
