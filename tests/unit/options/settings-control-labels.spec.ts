import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { ArchiveFormatPicker } from "@/entrypoints/options/components/ArchiveFormatPicker"
import { GlobalPerformanceSection } from "@/entrypoints/options/components/GlobalPerformanceSection"
import { GlobalInterfacePreferencesSection } from "@/entrypoints/options/components/GlobalInterfacePreferencesSection"
import { PathVisualization } from "@/entrypoints/options/components/PathVisualization"
import { CustomSettingField } from "@/entrypoints/options/components/CustomSettingField"

vi.mock("@/src/runtime/i18n", () => ({
  t: (key: string) => key,
  getLocaleDisplayName: (locale: string) => locale,
}))

describe("options control labels", () => {
  it("names the archive format radio group", () => {
    const markup = renderToStaticMarkup(
      createElement(ArchiveFormatPicker, {
        showNoArchiveWarning: false,
        value: "cbz",
        onValueChange: vi.fn(),
      })
    )

    expect(markup).toContain('id="archive-format-label"')
    expect(markup).toContain('aria-labelledby="archive-format-label"')
  })

  it("uses a labeled fieldset for multiselect integration settings", () => {
    const markup = renderToStaticMarkup(
      createElement(CustomSettingField, {
        integrationId: "mangadex",
        schema: {
          id: "languages",
          labelKey: "mangadexSetting_chapterLanguageFilterLabel",
          descriptionKey: "mangadexSetting_chapterLanguageFilterDescription",
          type: "multiselect",
          defaultValue: [],
          options: [
            {
              value: "en",
              labelKey: "mangadexSetting_chapterLanguageFilterOption_en",
            },
          ],
        },
        enabled: true,
        effectiveValue: [],
        onChange: vi.fn(),
      })
    )

    expect(markup).toContain("<fieldset")
    expect(markup).toContain(
      'aria-labelledby="mangadex-custom-languages-label"'
    )
    expect(markup).toContain(
      'aria-describedby="mangadex-custom-languages-description"'
    )
  })

  it("gives the image concurrency slider thumb an accessible name", () => {
    const markup = renderToStaticMarkup(
      createElement(GlobalPerformanceSection, {
        chapterPolicy: { concurrency: 1, delayMs: 0 },
        imagePolicy: { concurrency: 3, delayMs: 0 },
        onChapterPolicyChange: vi.fn(),
        onImagePolicyChange: vi.fn(),
      })
    )

    expect(markup).toContain('role="slider"')
    expect(markup).toContain('aria-label="options_imageConcurrency"')
  })

  it("renders the selected archive extension in the path preview", () => {
    const zipMarkup = renderToStaticMarkup(
      createElement(PathVisualization, {
        template: "Series",
        filenameTemplate: "Chapter",
        format: "zip",
      })
    )
    const folderMarkup = renderToStaticMarkup(
      createElement(PathVisualization, {
        template: "Series",
        filenameTemplate: "Chapter",
        format: "none",
      })
    )

    expect(zipMarkup).toContain(".zip")
    expect(zipMarkup).not.toContain(".cbz")
    expect(folderMarkup).not.toMatch(/\.(cbz|zip)/)
  })

  it("labels language and three-state motion selectors", () => {
    const markup = renderToStaticMarkup(
      createElement(GlobalInterfacePreferencesSection, {
        motionPreference: "system",
        uiLanguage: "auto",
        onMotionPreferenceChange: vi.fn(),
        onUiLanguageChange: vi.fn(),
      })
    )

    expect(markup).toContain('for="ui-language"')
    expect(markup).toContain('id="ui-language"')
    expect(markup).toContain('for="motion-preference"')
    expect(markup).toContain('id="motion-preference"')
    expect(markup).not.toContain('role="switch"')
  })
})
