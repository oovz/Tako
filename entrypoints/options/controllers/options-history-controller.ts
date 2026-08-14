import type { OptionsConfigurationData } from "@/src/runtime/runtime-message-contracts"
import {
  OptionsConfigurationClient,
  type OptionsConfigurationLoader,
} from "./options-configuration-client"

export type OptionsHistoryScope =
  | { scope: "all" }
  | { scope: "series"; siteIntegrationId: string; seriesId: string }

/** Owns Options history refresh and the command-then-refresh sequence. */
export class OptionsHistoryController {
  constructor(
    private readonly configuration: OptionsConfigurationLoader = new OptionsConfigurationClient(),
    private readonly clearHistory: (
      scope: OptionsHistoryScope
    ) => Promise<void> = (scope) =>
      OptionsConfigurationClient.clearHistory(scope)
  ) {}

  async refresh(): Promise<OptionsConfigurationData> {
    return this.configuration.load()
  }

  async clear(scope: OptionsHistoryScope): Promise<OptionsConfigurationData> {
    await this.clearHistory(scope)
    return this.refresh()
  }
}
