import { mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium, type BrowserContext, type Page } from "playwright";

import {
  resolveTemplate,
  type LoadedConfig,
  type PhaseAction,
  type SiteConfig,
} from "./config.js";

export type EngineSession = {
  context: BrowserContext;
  page: Page;
  templateContext: Record<string, unknown>;
  site: SiteConfig;
};

export async function createSession(config: LoadedConfig): Promise<EngineSession> {
  const browserConfig = config.site.browser;
  const context = await chromium.launchPersistentContext(
    path.resolve(browserConfig.userDataDir),
    {
      headless: browserConfig.headless,
      slowMo: browserConfig.slowMo,
      channel: browserConfig.channel,
      viewport: browserConfig.viewport,
    },
  );

  context.setDefaultTimeout(config.site.defaults.timeoutMs);
  context.setDefaultNavigationTimeout(config.site.defaults.navigationTimeoutMs);

  const existingPage = context.pages()[0];
  const page = existingPage ?? (await context.newPage());

  return {
    context,
    page,
    site: config.site,
    templateContext: {
      applicant: config.applicant,
      site: config.site,
      env: process.env,
      now: {
        iso: new Date().toISOString(),
        epochMs: Date.now(),
      },
      paths: {
        applicantConfig: config.applicantPath,
        siteConfig: config.sitePath,
      },
    },
  };
}

export async function runPhase(
  session: EngineSession,
  phase: PhaseAction[],
  label: string,
) {
  for (const rawAction of phase) {
    const action = resolveTemplate(rawAction, session.templateContext);
    process.stdout.write(`\n[${label}] ${action.name}\n`);
    await executeAction(session, action);
  }
}

async function executeAction(session: EngineSession, action: PhaseAction) {
  const page = await getActivePage(session);
  await waitForCaptchaToClear(session, action.name);

  switch (action.action) {
    case "goto":
      ensure(action.url, action.name, "url");
      await page.goto(action.url, { waitUntil: action.waitUntil ?? "load" });
      await waitForCaptchaToClear(session, action.name);
      return;

    case "waitFor":
      ensure(action.selector, action.name, "selector");
      await waitForSelectorWithCaptchaHandling(session, action);
      return;

    case "waitForAny":
      await waitForAny(session, action);
      return;

    case "waitForOpen":
      ensure(action.selector, action.name, "selector");
      await waitForOpen(session, action);
      return;

    case "waitForUrlChange":
      await waitForUrlChange(session, action);
      return;

    case "click":
      ensure(action.selector, action.name, "selector");
      await page.locator(action.selector).click({ timeout: action.timeoutMs });
      await waitForCaptchaToClear(session, action.name);
      return;

    case "clickNoWait":
      ensure(action.selector, action.name, "selector");
      await page.locator(action.selector).click({
        timeout: action.timeoutMs,
        noWaitAfter: true,
      });
      await waitForCaptchaToClear(session, action.name);
      return;

    case "clickIfPresent":
      ensure(action.selector, action.name, "selector");
      if ((await page.locator(action.selector).count()) > 0) {
        await page.locator(action.selector).first().click({ timeout: action.timeoutMs });
        await waitForCaptchaToClear(session, action.name);
      } else {
        process.stdout.write(`Optional selector not present, skipping: ${action.selector}\n`);
      }
      return;

    case "clickIfPageTextContains":
      ensure(action.selector, action.name, "selector");
      ensure(action.text, action.name, "text");
      if ((await page.locator(`text=${action.text}`).count()) > 0) {
        if ((await page.locator(action.selector).count()) > 0) {
          await page.locator(action.selector).first().click({ timeout: action.timeoutMs });
          await waitForCaptchaToClear(session, action.name);
        } else {
          process.stdout.write(`Page text matched but selector not present, skipping: ${action.selector}\n`);
        }
      } else {
        process.stdout.write(`Page text not present, skipping click: ${action.text}\n`);
      }
      return;

    case "fill":
      ensure(action.selector, action.name, "selector");
      if (typeof action.value !== "string") {
        throw new Error(`Action "${action.name}" requires string value.`);
      }
      await page.locator(action.selector).fill(action.value, {
        timeout: action.timeoutMs,
      });
      return;

    case "fillIfPresent":
      ensure(action.selector, action.name, "selector");
      if (typeof action.value !== "string") {
        throw new Error(`Action "${action.name}" requires string value.`);
      }
      if ((await page.locator(action.selector).count()) > 0) {
        await page.locator(action.selector).first().fill(action.value, {
          timeout: action.timeoutMs,
        });
      } else {
        process.stdout.write(`Optional selector not present, skipping fill: ${action.selector}\n`);
      }
      return;

    case "fillIfValue":
      ensure(action.selector, action.name, "selector");
      if (typeof action.value === "string" && action.value !== "") {
        await page.locator(action.selector).fill(action.value, {
          timeout: action.timeoutMs,
        });
      } else {
        process.stdout.write(`Optional fill value empty, skipping: ${action.selector}\n`);
      }
      return;

    case "select":
      ensure(action.selector, action.name, "selector");
      ensure(action.value, action.name, "value");
      await page.locator(action.selector).selectOption(action.value, {
        timeout: action.timeoutMs,
        force: true,
      });
      return;

    case "selectIfValue":
      ensure(action.selector, action.name, "selector");
      if (action.value !== undefined && action.value !== null && action.value !== "") {
        await page.locator(action.selector).selectOption(action.value, {
          timeout: action.timeoutMs,
          force: true,
        });
      } else {
        process.stdout.write(`Optional select value empty, skipping: ${action.selector}\n`);
      }
      return;

    case "selectVisibleYesRadios":
      await selectVisibleYesRadios(page, action.text);
      return;

    case "check":
      ensure(action.selector, action.name, "selector");
      if (action.checked === false) {
        await page.locator(action.selector).uncheck({ timeout: action.timeoutMs });
      } else {
        await page.locator(action.selector).check({ timeout: action.timeoutMs });
      }
      return;

    case "upload":
      ensure(action.selector, action.name, "selector");
      ensure(action.path, action.name, "path");
      await page.locator(action.selector).setInputFiles(path.resolve(action.path), {
        timeout: action.timeoutMs,
      });
      return;

    case "press":
      ensure(action.selector, action.name, "selector");
      ensure(action.key, action.name, "key");
      await page.locator(action.selector).press(action.key, {
        timeout: action.timeoutMs,
      });
      await waitForCaptchaToClear(session, action.name);
      return;

    case "sleep":
      await sleep(action.durationMs ?? 1000);
      return;

    case "screenshot":
      await takeNamedScreenshot(session, action.path, action.fullPage ?? true);
      return;

    case "pause":
      await pauseForUser(action.message ?? `${action.name} completed. Press Enter to continue.`);
      return;
  }
}

async function waitForOpen(session: EngineSession, action: PhaseAction) {
  const releaseAt = action.releaseAt
    ? parseReleaseAt(action.releaseAt, action.name)
    : Date.now();
  const timeoutAt = Date.now() + (action.timeoutMs ?? 60 * 60 * 1000);
  const preReleaseInterval = action.preReleaseIntervalMs ?? 30_000;
  const finalCountdownWindow = action.finalCountdownWindowMs ?? 120_000;
  const finalCountdownInterval = action.finalCountdownIntervalMs ?? Math.min(preReleaseInterval, 5_000);
  const releaseInterval = action.intervalMs ?? 1_000;

  while (Date.now() < timeoutAt) {
    await waitForCaptchaToClear(session, action.name);

    try {
      const page = await getActivePage(session);
      const locator = page.locator(action.selector!);
      if (await locator.first().isVisible()) {
        return;
      }
    } catch {
      // Ignore transient DOM/navigation errors while polling.
    }

    if (action.reload) {
      const page = await getActivePage(session);
      await page.reload({ waitUntil: "domcontentloaded" });
    }

    const msToRelease = releaseAt - Date.now();
    let sleepFor = releaseInterval;
    if (msToRelease > finalCountdownWindow) {
      sleepFor = preReleaseInterval;
    } else if (msToRelease > 0) {
      sleepFor = finalCountdownInterval;
    }
    await sleep(sleepFor);
  }

  throw new Error(`Timed out waiting for open state in action "${action.name}".`);
}

async function waitForUrlChange(session: EngineSession, action: PhaseAction) {
  const timeoutAt = Date.now() + (action.timeoutMs ?? 15 * 60 * 1000);
  const initialPage = await getActivePage(session);
  const initialUrl = initialPage.url();

  while (Date.now() < timeoutAt) {
    await waitForCaptchaToClear(session, action.name);

    const page = await getActivePage(session);
    const currentUrl = page.url();
    const changed = currentUrl !== initialUrl;
    const includesOk = action.urlIncludes ? currentUrl.includes(action.urlIncludes) : true;
    const regexOk = action.urlMatches
      ? new RegExp(action.urlMatches).test(currentUrl)
      : true;

    if (changed && includesOk && regexOk) {
      return;
    }

    await sleep(action.intervalMs ?? 1000);
  }

  throw new Error(`Timed out waiting for URL change in action "${action.name}".`);
}

async function waitForAny(session: EngineSession, action: PhaseAction) {
  const timeoutAt = Date.now() + (action.timeoutMs ?? 15_000);
  const state = action.state ?? "visible";
  const selectors = action.selectors ?? (action.selector ? [action.selector] : []);
  const urlIncludesAny = action.urlIncludesAny ?? (action.urlIncludes ? [action.urlIncludes] : []);

  if (selectors.length === 0 && urlIncludesAny.length === 0) {
    throw new Error(`Action "${action.name}" requires selectors and/or urlIncludesAny.`);
  }

  while (Date.now() < timeoutAt) {
    await waitForCaptchaToClear(session, action.name);

    try {
      const page = await getActivePage(session);
      const currentUrl = page.url();

      if (urlIncludesAny.some((fragment) => currentUrl.includes(fragment))) {
        return;
      }

      for (const selector of selectors) {
        try {
          await page.waitForSelector(selector, {
            state,
            timeout: Math.min(1_000, Math.max(250, timeoutAt - Date.now())),
          });
          return;
        } catch {
          // Keep trying other selectors and polling until timeout.
        }
      }
    } catch {
      // Ignore transient navigation / page state issues while polling.
    }

    await sleep(action.intervalMs ?? 1000);
  }

  throw new Error(`Timed out waiting for any expected state in action "${action.name}".`);
}

async function waitForSelectorWithCaptchaHandling(
  session: EngineSession,
  action: PhaseAction,
) {
  const timeoutAt = Date.now() + (action.timeoutMs ?? 15_000);
  const state = action.state ?? "visible";

  while (Date.now() < timeoutAt) {
    await waitForCaptchaToClear(session, action.name);

    try {
      const page = await getActivePage(session);
      await page.waitForSelector(action.selector!, {
        state,
        timeout: Math.min(2_000, Math.max(500, timeoutAt - Date.now())),
      });
      return;
    } catch {
      // Keep polling until the selector appears or the overall timeout expires.
    }
  }

  throw new Error(`Timed out waiting for selector in action "${action.name}".`);
}

export async function captureFailure(session: EngineSession, name = "failure") {
  try {
    await takeNamedScreenshot(session, `${name}-${Date.now()}.png`, true);
  } catch {
    // Best effort only.
  }
}

async function takeNamedScreenshot(
  session: EngineSession,
  targetPath: string | undefined,
  fullPage: boolean,
) {
  const directory = path.resolve(session.site.defaults.screenshotDir);
  await mkdir(directory, { recursive: true });
  const screenshotPath = path.isAbsolute(targetPath ?? "")
    ? (targetPath as string)
    : path.join(directory, targetPath ?? `shot-${Date.now()}.png`);
  await session.page.screenshot({
    path: screenshotPath,
    fullPage,
  });
  process.stdout.write(`Saved screenshot: ${screenshotPath}\n`);
}

function ensure<T>(value: T, actionName: string, field: string): asserts value is NonNullable<T> {
  if (value === undefined || value === null || value === "") {
    throw new Error(`Action "${actionName}" requires field "${field}".`);
  }
}

function parseReleaseAt(rawValue: string | undefined, actionName: string) {
  if (!rawValue) {
    throw new Error(`Action "${actionName}" requires releaseAt.`);
  }
  const releaseAt = new Date(rawValue).getTime();
  if (Number.isNaN(releaseAt)) {
    throw new Error(`Invalid releaseAt in action "${actionName}": ${rawValue}`);
  }
  return releaseAt;
}

async function pauseForUser(message: string) {
  if (process.env.AUTO_CONTINUE_PAUSES === "1") {
    process.stdout.write(`${message}\nAUTO_CONTINUE_PAUSES=1, continuing without terminal input.\n`);
    return;
  }

  const rl = readline.createInterface({ input, output });
  try {
    await rl.question(`${message}\n`);
  } finally {
    rl.close();
  }
}

async function waitForCaptchaToClear(session: EngineSession, actionName: string) {
  const page = await getActivePage(session);
  if (!(await isCaptchaPage(page))) {
    return;
  }

  process.stdout.write(
    `CAPTCHA detected during "${actionName}". Please complete it manually in the browser; the script will resume automatically once the page is clear.\n`,
  );

  await captureFailure(session, "captcha");

  const timeoutAt = Date.now() + 60 * 60 * 1000;
  let announcedWaiting = false;

  while (Date.now() < timeoutAt) {
    const currentPage = await getActivePage(session);
    if (!(await isCaptchaPage(currentPage))) {
      await sleep(1500);
      if (!(await isCaptchaPage(currentPage))) {
        process.stdout.write(`CAPTCHA cleared. Resuming "${actionName}".\n`);
        return;
      }
    }

    if (!announcedWaiting) {
      announcedWaiting = true;
      process.stdout.write("Waiting for manual CAPTCHA completion...\n");
    }

    await sleep(1000);
  }

  throw new Error(`Timed out waiting for CAPTCHA to clear during "${actionName}".`);
}

async function isCaptchaPage(page: Page) {
  const url = page.url().toLowerCase();
  if (url.includes("rs-captcha") || url.includes("recaptcha") || url.includes("captcha")) {
    return true;
  }

  try {
    return await page.evaluate(() => {
      const text = document.body?.innerText?.toLowerCase() ?? "";
      if (
        text.includes("please complete the captcha") ||
        text.includes("complete the captcha") ||
        text.includes("verify you are human")
      ) {
        return true;
      }

      return Boolean(
        document.querySelector(
          "#g-recaptcha-response, iframe[src*='recaptcha'], form[action*='captcha'], .g-recaptcha",
        ),
      );
    });
  } catch {
    return false;
  }
}

async function getActivePage(session: EngineSession) {
  if (!session.page.isClosed()) {
    return session.page;
  }

  const openPages = session.context.pages().filter((candidate) => !candidate.isClosed());
  if (openPages.length > 0) {
    session.page = openPages[openPages.length - 1];
    return session.page;
  }

  session.page = await session.context.waitForEvent("page", { timeout: 30_000 });
  return session.page;
}

async function sleep(durationMs: number) {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function selectVisibleYesRadios(page: Page, requiredText?: string) {
  const result = await page.evaluate((expectedText) => {
    const bodyText = document.body?.innerText ?? "";
    if (expectedText && !bodyText.includes(expectedText)) {
      return { matched: false, radioTouched: 0, checkboxTouched: 0 };
    }

    const isVisible = (el: Element) => {
      const html = el as HTMLElement;
      const style = window.getComputedStyle(html);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        !!(html.offsetWidth || html.offsetHeight || html.getClientRects().length)
      );
    };

    const radios = Array.from(document.querySelectorAll("input[type='radio']")).filter(isVisible);
    const groups = new Map<string, HTMLInputElement[]>();

    for (const radio of radios) {
      const input = radio as HTMLInputElement;
      const key = input.name || input.id;
      if (!key) {
        continue;
      }
      const existing = groups.get(key) ?? [];
      existing.push(input);
      groups.set(key, existing);
    }

    let radioTouched = 0;

    const extractText = (input: HTMLInputElement) => {
      const byFor = input.id
        ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent ?? ""
        : "";
      const parent = input.parentElement?.textContent ?? "";
      const row = input.closest("tr, li, .form-group, div, td")?.textContent ?? "";
      return `${byFor} ${parent} ${row}`.replace(/\s+/g, " ").trim().toLowerCase();
    };

    for (const entries of groups.values()) {
      const visibleEntries = entries.filter(isVisible);
      if (visibleEntries.length === 0) {
        continue;
      }

      const yesEntry =
        visibleEntries.find((input) => /\byes\b/.test(extractText(input))) ?? visibleEntries[0];

      if (!yesEntry.checked) {
        yesEntry.click();
      }
      radioTouched += 1;
    }

    const checkboxes = Array.from(document.querySelectorAll("input[type='checkbox']")).filter(isVisible);
    let checkboxTouched = 0;

    for (const checkbox of checkboxes) {
      const input = checkbox as HTMLInputElement;
      if (!input.checked) {
        input.click();
      }
      checkboxTouched += 1;
    }

    return { matched: true, radioTouched, checkboxTouched };
  }, requiredText);

  if (!result.matched) {
    process.stdout.write(
      `Page text "${requiredText}" not found, skipping visible Yes/No radio auto-selection.\n`,
    );
    return;
  }

  process.stdout.write(
    `Selected Yes/default option in ${result.radioTouched} visible radio group(s) and checked ${result.checkboxTouched} visible checkbox(es).\n`,
  );
}
