import type { RuntimeMessageRequest } from "@/src/runtime/runtime-message-contracts"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"

export type OptionsPageTarget = NonNullable<
  RuntimeMessageRequest<"OPEN_OPTIONS">["payload"]
>["page"]

export async function openOptionsPage(page?: OptionsPageTarget): Promise<void> {
  const response = await sendRuntimeMessage({
    target: "background",
    type: "OPEN_OPTIONS",
    payload: page ? { page } : {},
  })

  if (!response || response.success === false) {
    throw new Error(response?.error || "Failed to open options page")
  }
}
