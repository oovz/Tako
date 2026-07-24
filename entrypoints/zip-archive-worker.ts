import {
  installZipWorkerRuntime,
  type ZipWorkerRuntimeScope,
} from "./offscreen/zip.worker"

export default defineUnlistedScript({
  globalName: false,
  main() {
    installZipWorkerRuntime(self as unknown as ZipWorkerRuntimeScope)
  },
})
