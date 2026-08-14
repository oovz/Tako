import { createCommandEnvelope } from "@/src/runtime/command-envelope"
import { sendRuntimeMessage } from "@/src/runtime/send-runtime-message"
import type {
  OptionsConfigurationData,
  OptionsConfigurationSnapshot,
} from "@/src/runtime/runtime-message-contracts"

type SendMessage = typeof sendRuntimeMessage

/** The Options page's typed background configuration boundary. */
export class OptionsConfigurationClient {
  constructor(private readonly send: SendMessage = sendRuntimeMessage) {}

  async load(): Promise<OptionsConfigurationData> {
    const response = await this.send({
      target: "background",
      type: "GET_OPTIONS_CONFIGURATION",
    })
    if (!response.success) throw new Error(response.error)
    return response.data
  }

  async save(
    configuration: OptionsConfigurationSnapshot
  ): Promise<OptionsConfigurationSnapshot> {
    const response = await this.send({
      target: "background",
      type: "SAVE_OPTIONS_CONFIGURATION",
      ...createCommandEnvelope(),
      payload: { configuration },
    })
    if (!response.success) throw new Error(response.error)
    return response.data
  }

  static clearHistory(
    scope:
      | { scope: "all" }
      | { scope: "series"; siteIntegrationId: string; seriesId: string },
    send: SendMessage = sendRuntimeMessage
  ): Promise<void> {
    return send({
      target: "background",
      type: "CLEAR_PERSISTED_DOWNLOAD_HISTORY",
      ...createCommandEnvelope(),
      payload: scope,
    }).then((response) => {
      if (!response.success) throw new Error(response.error)
    })
  }
}

export type OptionsConfigurationLoader = Pick<
  OptionsConfigurationClient,
  "load"
>
