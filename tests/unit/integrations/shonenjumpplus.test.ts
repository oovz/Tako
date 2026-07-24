import { beforeEach } from "vitest"
import { registerShonenJumpPlusChapterListCases } from "./shonenjumpplus-chapter-list.cases"
import { resetShonenJumpPlusTestEnvironment } from "./shonenjumpplus-test-setup"

beforeEach(() => {
  resetShonenJumpPlusTestEnvironment()
})

registerShonenJumpPlusChapterListCases()
