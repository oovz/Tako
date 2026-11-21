import { expect, test } from "./extension"

const mangaDexSwitch = "#mangadex-integration-enabled"
const findIntegrationsTab =
  '[...document.querySelectorAll("nav button")].find(button => button.textContent.trim() === "Site Integrations")'
const findSaveButton =
  '[...document.querySelectorAll("button")].find(button => button.textContent.trim() === "Save Changes")'
const permissionNotification = "addon-webext-permissions"

test("requires Firefox site access and reporting consent for MangaDex", async ({
  extension,
}) => {
  await extension.openSidebar()
  await extension.clickSidebar('button[aria-label^="Open Options"]')

  const { activePage, firefox } = extension
  await expect
    .poll(() =>
      activePage(`return Boolean(${findIntegrationsTab})`).catch(() => false)
    )
    .toBe(true)
  await activePage(`(${findIntegrationsTab}).click()`)

  const isEnabled = () =>
    activePage<string | null>(
      `return document.querySelector(${JSON.stringify(mangaDexSwitch)})?.getAttribute("aria-checked") ?? null`
    )
  const hasSiteAccess = () =>
    activePage<boolean>(
      'return browser.permissions.contains({ origins: ["https://*/*"] })'
    )
  const hasReportingConsent = () =>
    activePage<boolean>(
      'return browser.permissions.contains({ data_collection: ["websiteActivity"] })'
    )

  await expect.poll(isEnabled).toBe("false")
  expect(await hasSiteAccess()).toBe(false)
  expect(await hasReportingConsent()).toBe(false)

  // This WebDriver click supplies the user activation Firefox requires.
  await firefox.clickContent(mangaDexSwitch)
  await expect
    .poll(() =>
      firefox.execute(
        `return PopupNotifications.getNotification(arguments[0], gBrowser.selectedBrowser)?.options?.name ?? null;`,
        permissionNotification
      )
    )
    .toBe("Tako Manga Downloader")
  expect(await isEnabled()).toBe("false")

  await expect
    .poll(() =>
      firefox.execute(
        `
        const element = document.getElementById(arguments[0] + "-notification");
        const notification = element?.notification;
        const delay = Services.prefs.getIntPref("security.notification_enable_delay");
        if (!notification?.timeShown || ChromeUtils.now() - notification.timeShown < delay) return false;
        element.button.click();
        return true;
      `,
        permissionNotification
      )
    )
    .toBe(true)
  await expect.poll(hasSiteAccess).toBe(true)
  expect(await hasReportingConsent()).toBe(true)
  await expect.poll(isEnabled).toBe("true")

  // Firefox can suspend its event page while the newly granted permissions
  // are still part of an unsaved Options draft.
  const stopped = await firefox.executeAsync<string>(`
    const done = arguments[0];
    const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
    const id = WebExtensionPolicy.getByHostname(gBrowser.currentURI.host).id;
    const addon = ExtensionParent.GlobalManager.getExtension(id);
    addon.terminateBackground({ disableResetIdleForTest: true }).then(
      () => done(addon.backgroundState),
      error => done(String(error))
    );
  `)
  expect(stopped).toBe("stopped")
  expect(
    await activePage(`
      return browser.runtime.sendMessage({
        target: "background",
        type: "GET_OPTIONS_CONFIGURATION",
      }).then(result => result.success)
    `)
  ).toBe(true)
  expect(await hasSiteAccess()).toBe(true)
  expect(await hasReportingConsent()).toBe(true)

  await expect
    .poll(() =>
      activePage<boolean>(`
        const button = ${findSaveButton};
        if (!button || button.disabled) return false;
        button.click();
        return true;
      `)
    )
    .toBe(true)
  await expect
    .poll(() => activePage(`return Boolean(${findSaveButton})`))
    .toBe(false)
  await firefox.execute("gBrowser.selectedBrowser.reload()")
  await expect.poll(() => isEnabled().catch(() => null)).toBe("true")
  expect(await hasSiteAccess()).toBe(true)
  expect(await hasReportingConsent()).toBe(true)

  expect(
    await activePage(
      'return browser.permissions.remove({ data_collection: ["websiteActivity"] })'
    )
  ).toBe(true)
  expect(await hasReportingConsent()).toBe(false)
  await expect.poll(isEnabled).toBe("false")
})
