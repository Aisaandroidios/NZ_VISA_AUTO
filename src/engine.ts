import { mkdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium, type BrowserContext, type Frame, type Locator, type Page } from "playwright";

import {
  resolveTemplate,
  type LoadedConfig,
  type PhaseAction,
  type SiteConfig,
} from "./config.js";
import { assertApplicantRuntimeLicense } from "./license.js";

export type EngineSession = {
  context: BrowserContext;
  page: Page;
  templateContext: Record<string, unknown>;
  site: SiteConfig;
};

export async function createSession(config: LoadedConfig): Promise<EngineSession> {
  assertApplicantRuntimeLicense({
    applicant: config.applicant,
    guard: config.licenseGuard,
    reason: "create-session",
  });

  const browserConfig = config.site.browser;
  const browserChannel = process.env.NZVA_USE_BUNDLED_CHROMIUM === "1"
    ? undefined
    : browserConfig.channel;
  const context = await chromium.launchPersistentContext(
    path.resolve(browserConfig.userDataDir),
    {
      headless: browserConfig.headless,
      slowMo: browserConfig.slowMo,
      channel: browserChannel,
      viewport: browserConfig.viewport,
    },
  );

  context.setDefaultTimeout(config.site.defaults.timeoutMs);
  context.setDefaultNavigationTimeout(config.site.defaults.navigationTimeoutMs);

  const existingPages = context.pages();
  const page = await context.newPage();

  for (const stalePage of existingPages) {
    if (!stalePage.isClosed()) {
      await stalePage.close().catch(() => {
        // Stale tabs from a previous test run should not block a fresh run.
      });
    }
  }

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
    await paceAfterAction(session, action);
  }
}

async function paceAfterAction(session: EngineSession, action: PhaseAction) {
  if (action.postActionDelayMs !== undefined) {
    await sleep(action.postActionDelayMs);
    return;
  }

  const delayMs = getDefaultActionDelayMs(session, action);
  if (delayMs > 0) {
    await sleep(delayMs);
  }
}

function getDefaultActionDelayMs(session: EngineSession, action: PhaseAction) {
  const defaults = session.site.defaults;

  if (["sleep", "pause", "screenshot", "waitFor", "waitForAny", "waitForOpen", "waitForUrlChange", "fillPaymentCardDetails", "clickPaymentFinalPay"].includes(action.action)) {
    return 0;
  }

  if (["fill", "fillIfPresent", "fillIfValue", "select", "selectIfValue", "check", "selectVisibleYesRadios", "checkConfirmYesDeclarations"].includes(action.action)) {
    return defaults.fieldDelayMs;
  }

  if (action.action === "goto" || isNavigationLikeAction(action)) {
    return defaults.navigationDelayMs;
  }

  if (["click", "clickNoWait", "clickIfPresent", "clickIfPageTextContains", "waitAndClickOpen", "press", "upload"].includes(action.action)) {
    return defaults.clickDelayMs;
  }

  return defaults.defaultActionDelayMs;
}

function isNavigationLikeAction(action: PhaseAction) {
  const haystack = `${action.name} ${action.selector ?? ""}`.toLowerCase();
  return (
    haystack.includes(" next") ||
    haystack.includes("go to ") ||
    haystack.includes("nextimagebutton")
  );
}

async function executeAction(session: EngineSession, action: PhaseAction) {
  const page = await getActivePage(session);
  await waitForCaptchaToClear(session, action.name);
  if (action.preActionDelayMs) {
    await sleep(action.preActionDelayMs);
  }

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

    case "waitAndClickOpen":
      ensure(action.selector, action.name, "selector");
      await waitForOpen(session, action, { clickWhenVisible: true });
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
      if (await clickLastVisible(page.locator(action.selector), action.timeoutMs)) {
        await waitForCaptchaToClear(session, action.name);
      } else {
        process.stdout.write(`Optional selector not visible, skipping: ${action.selector}\n`);
      }
      return;

    case "clickIfPageTextContains":
      ensure(action.selector, action.name, "selector");
      ensure(action.text, action.name, "text");
      if ((await page.locator(`text=${action.text}`).count()) > 0) {
        const clicked = await clickLastVisible(page.locator(action.selector), action.timeoutMs);
        if (clicked) {
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

    case "checkConfirmYesDeclarations":
      await checkConfirmYesDeclarations(page, action.text ?? "Confirm Submit");
      return;

    case "fillPaymentCardDetails":
      await fillPaymentCardDetails(session, action);
      return;

    case "clickPaymentFinalPay":
      await clickPaymentFinalPay(session, action);
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

async function waitForOpen(
  session: EngineSession,
  action: PhaseAction,
  options: { clickWhenVisible?: boolean } = {},
) {
  const releaseAt = action.releaseAt
    ? parseReleaseAt(action.releaseAt, action.name)
    : Date.now();
  const timeoutAt = Date.now() + (action.timeoutMs ?? 60 * 60 * 1000);
  const preReleaseInterval = action.preReleaseIntervalMs ?? 30_000;
  const finalCountdownWindow = action.finalCountdownWindowMs ?? 120_000;
  const finalCountdownInterval = action.finalCountdownIntervalMs ?? Math.min(preReleaseInterval, 5_000);
  const hotCountdownWindow = Math.min(
    action.hotCountdownWindowMs ?? 15_000,
    finalCountdownWindow,
  );
  const hotCountdownInterval = action.hotCountdownIntervalMs ?? Math.min(finalCountdownInterval, 500);
  const releaseInterval = action.intervalMs ?? 1_000;
  let lastPollMode: string | undefined;

  while (Date.now() < timeoutAt) {
    await waitForCaptchaToClear(session, action.name);

    if (await tryResolveOpenTarget(session, action, options, timeoutAt)) {
      return;
    }

    if (action.reload) {
      const page = await getActivePage(session);
      try {
        await page.reload({
          waitUntil: action.waitUntil ?? "domcontentloaded",
          timeout: Math.min(
            action.reloadTimeoutMs ?? 5_000,
            Math.max(500, timeoutAt - Date.now()),
          ),
        });
      } catch {
        // A slow busy-server refresh should not block later polling attempts.
      }
      if (await tryResolveOpenTarget(session, action, options, timeoutAt)) {
        return;
      }
    }

    const msToRelease = releaseAt - Date.now();
    const poll = getOpenPollingCadence({
      msToRelease,
      preReleaseInterval,
      finalCountdownWindow,
      finalCountdownInterval,
      hotCountdownWindow,
      hotCountdownInterval,
      releaseInterval,
    });
    if (poll.mode !== lastPollMode) {
      lastPollMode = poll.mode;
      process.stdout.write(
        `Open polling mode: ${poll.mode}; next check in ${poll.intervalMs}ms; release in ${formatRelativeMs(msToRelease)}.\n`,
      );
    }
    await sleep(poll.intervalMs);
  }

  throw new Error(`Timed out waiting for open state in action "${action.name}".`);
}

async function tryResolveOpenTarget(
  session: EngineSession,
  action: PhaseAction,
  options: { clickWhenVisible?: boolean },
  timeoutAt: number,
) {
  try {
    const page = await getActivePage(session);
    const locator = page.locator(action.selector!).first();
    if (options.clickWhenVisible) {
      const clicked = await tryFastClickOpenTarget(locator, action, timeoutAt);
      if (clicked) {
        process.stdout.write(`Open target clicked immediately: ${action.selector}\n`);
        await waitForCaptchaToClear(session, action.name);
        if (action.postClickWaitMs) {
          await sleep(action.postClickWaitMs);
        }
        return true;
      }
      return false;
    }

    if (await locator.isVisible()) {
      process.stdout.write(`Open target detected: ${action.selector}\n`);
      return true;
    }
  } catch {
    // Ignore transient DOM/navigation errors while polling.
  }

  return false;
}

async function clickLastVisible(
  locator: ReturnType<Page["locator"]>,
  timeoutMs: number | undefined,
) {
  const count = await locator.count();
  for (let index = count - 1; index >= 0; index -= 1) {
    const candidate = locator.nth(index);
    try {
      if (await candidate.isVisible()) {
        await candidate.click({ timeout: timeoutMs });
        return true;
      }
    } catch {
      // Keep trying earlier visible candidates.
    }
  }

  return false;
}

async function tryFastClickOpenTarget(
  locator: ReturnType<Page["locator"]>,
  action: PhaseAction,
  timeoutAt: number,
) {
  const remainingMs = timeoutAt - Date.now();
  if (remainingMs <= 0) {
    return false;
  }

  try {
    await locator.click({
      timeout: Math.min(action.clickTimeoutMs ?? 500, remainingMs),
      noWaitAfter: true,
    });
    return true;
  } catch {
    return false;
  }
}

function getOpenPollingCadence(input: {
  msToRelease: number;
  preReleaseInterval: number;
  finalCountdownWindow: number;
  finalCountdownInterval: number;
  hotCountdownWindow: number;
  hotCountdownInterval: number;
  releaseInterval: number;
}) {
  if (input.msToRelease > input.finalCountdownWindow) {
    return { mode: "pre-release", intervalMs: input.preReleaseInterval };
  }

  if (input.msToRelease > input.hotCountdownWindow) {
    return { mode: "final-countdown", intervalMs: input.finalCountdownInterval };
  }

  if (input.msToRelease > 0) {
    return { mode: "hot-countdown", intervalMs: input.hotCountdownInterval };
  }

  return { mode: "open-window", intervalMs: input.releaseInterval };
}

function formatRelativeMs(ms: number) {
  if (ms <= 0) {
    return "now";
  }

  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
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
        text.includes("captcha is required") ||
        text.includes("i'm not a robot") ||
        text.includes("i am not a robot") ||
        text.includes("verify you are human")
      ) {
        return true;
      }

      const responseFields = Array.from(
        document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(
          "#g-recaptcha-response, textarea[name='g-recaptcha-response'], textarea[name='h-captcha-response'], input[name='cf-turnstile-response']",
        ),
      );

      if (
        responseFields.length > 0 &&
        responseFields.some((field) => field.value.trim() !== "")
      ) {
        return false;
      }

      return Boolean(
        document.querySelector(
          "#g-recaptcha-response, textarea[name='g-recaptcha-response'], textarea[name='h-captcha-response'], input[name='cf-turnstile-response'], iframe[src*='recaptcha'], iframe[title*='recaptcha' i], iframe[src*='captcha'], iframe[title*='captcha' i], form[action*='captcha'], .g-recaptcha, .h-captcha, [data-sitekey]",
        ),
      );
    });
  } catch {
    return false;
  }
}

async function getActivePage(session: EngineSession) {
  const openPages = session.context.pages().filter((candidate) => !candidate.isClosed());

  const workingHolidayPage = openPages
    .slice()
    .reverse()
    .find((candidate) => {
      const url = candidate.url().toLowerCase();
      return (
        url.includes("/workingholiday/") &&
        !url.includes("captcha") &&
        !url.includes("rs-captcha")
      );
    });

  if (workingHolidayPage) {
    session.page = workingHolidayPage;
    return session.page;
  }

  if (!session.page.isClosed()) {
    return session.page;
  }

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

type PaymentCardConfig = Record<string, unknown>;

type PaymentFieldTask = {
  key: string;
  label: string;
  value: string;
  labelPatterns: RegExp[];
  placeholderPatterns: RegExp[];
  selectors: string[];
  required?: boolean;
  selectValues?: string[];
};

async function fillPaymentCardDetails(session: EngineSession, action: PhaseAction) {
  const config = getPaymentCardConfig(session);
  const cardNumber = readPaymentValue(config, ["cardNumber", "number"]);
  const cardholderName = readPaymentValue(config, [
    "cardholderName",
    "cardHolderName",
    "nameOnCard",
    "name",
  ]);
  const payerName = readPaymentValue(config, [
    "payerName",
    "payer",
    "paymentName",
  ]) || cardholderName;
  const securityCode = readPaymentValue(config, [
    "securityCode",
    "cvv",
    "cvc",
    "csc",
  ]);
  const expiry = readPaymentValue(config, ["expiry", "expiryDate", "expirationDate"]);
  const parsedExpiry = parseExpiryParts(expiry);
  const expiryMonth =
    readPaymentValue(config, ["expiryMonth", "expirationMonth", "month"]) ||
    parsedExpiry.month;
  const expiryYear =
    readPaymentValue(config, ["expiryYear", "expirationYear", "year"]) ||
    parsedExpiry.year;
  const email = readPaymentValue(config, ["email", "receiptEmail"]);
  const postalCode = readPaymentValue(config, ["postalCode", "postcode", "zip"]);

  const simpleTasks: PaymentFieldTask[] = [];
  if (payerName) {
    simpleTasks.push(createPayerNameTask(payerName));
  }
  if (cardholderName) {
    simpleTasks.push(createCardholderNameTask(cardholderName));
  }
  if (cardNumber) {
    simpleTasks.push(createCardNumberTask(cardNumber));
  }
  if (securityCode) {
    simpleTasks.push(createSecurityCodeTask(securityCode));
  }
  if (email) {
    simpleTasks.push(createEmailTask(email));
  }
  if (postalCode) {
    simpleTasks.push(createPostalCodeTask(postalCode));
  }

  const expiryCombinedValue = expiry || buildCombinedExpiry(expiryMonth, expiryYear);
  const expiryTasks = {
    combined: expiryCombinedValue ? createExpiryTask(expiryCombinedValue) : undefined,
    month: expiryMonth ? createExpiryMonthTask(expiryMonth) : undefined,
    year: expiryYear ? createExpiryYearTask(expiryYear) : undefined,
  };
  const hasExpiry = Boolean(expiryTasks.combined || expiryTasks.month || expiryTasks.year);

  if (simpleTasks.length === 0 && !hasExpiry) {
    process.stdout.write(
      "No payment values configured under applicant.payment; skipping payment card autofill.\n",
    );
    return;
  }

  process.stdout.write(
    "Waiting for the payment page after final submit, then filling configured card fields.\n",
  );

  const timeoutAt = Date.now() + (action.timeoutMs ?? 15 * 60 * 1000);
  const intervalMs = action.intervalMs ?? 1_000;
  const filled = new Set<string>();
  const clickedNavigationButtons = new Set<string>();
  let clickedPaymentContinue = false;

  while (Date.now() < timeoutAt) {
    await clickPaymentGatewayNavigation(session, clickedNavigationButtons);

    for (const task of simpleTasks) {
      if (!filled.has(task.key) && await fillPaymentTaskAcrossPages(session, task)) {
        filled.add(task.key);
      }
    }

    if (filled.has("payerName") && !clickedPaymentContinue) {
      clickedPaymentContinue = await clickPaymentContinueButton(session);
    }

    if (expiryTasks.combined && !filled.has(expiryTasks.combined.key)) {
      if (await fillPaymentTaskAcrossPages(session, expiryTasks.combined)) {
        filled.add(expiryTasks.combined.key);
      }
    }

    if (expiryTasks.month && !filled.has(expiryTasks.month.key)) {
      if (await fillPaymentTaskAcrossPages(session, expiryTasks.month)) {
        filled.add(expiryTasks.month.key);
      }
    }

    if (expiryTasks.year && !filled.has(expiryTasks.year.key)) {
      if (await fillPaymentTaskAcrossPages(session, expiryTasks.year)) {
        filled.add(expiryTasks.year.key);
      }
    }

    const simpleDone = simpleTasks
      .filter((task) => task.required !== false)
      .every((task) => filled.has(task.key));
    const expiryDone = !hasExpiry ||
      Boolean(expiryTasks.combined && filled.has(expiryTasks.combined.key)) ||
      Boolean(
        expiryTasks.month &&
        expiryTasks.year &&
        filled.has(expiryTasks.month.key) &&
        filled.has(expiryTasks.year.key),
      );

    if (simpleDone && expiryDone) {
      process.stdout.write(
        "Payment card fields filled.\n",
      );
      return;
    }

    await sleep(intervalMs);
  }

  const missing = simpleTasks
    .filter((task) => task.required !== false && !filled.has(task.key))
    .map((task) => task.label);
  if (hasExpiry) {
    const expiryDone = Boolean(expiryTasks.combined && filled.has(expiryTasks.combined.key)) ||
      Boolean(
        expiryTasks.month &&
        expiryTasks.year &&
        filled.has(expiryTasks.month.key) &&
        filled.has(expiryTasks.year.key),
      );
    if (!expiryDone) {
      missing.push("expiry date");
    }
  }

  throw new Error(
    `Timed out waiting for payment field(s): ${missing.join(", ")}. ` +
    "Leave the browser open and finish the payment details manually if the gateway layout changed.",
  );
}

function getPaymentCardConfig(session: EngineSession): PaymentCardConfig {
  const applicant = session.templateContext.applicant;
  if (!applicant || typeof applicant !== "object") {
    return {};
  }

  const rawPayment = (applicant as Record<string, unknown>).payment;
  if (!rawPayment || typeof rawPayment !== "object") {
    return {};
  }

  return resolveTemplate(rawPayment, session.templateContext) as PaymentCardConfig;
}

function readPaymentValue(config: PaymentCardConfig, keys: string[]) {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

function buildCombinedExpiry(month: string, year: string) {
  if (!month || !year) {
    return "";
  }

  const shortYear = year.length === 4 ? year.slice(2) : year;
  return `${month}/${shortYear}`;
}

function parseExpiryParts(value: string) {
  const match = value.match(/^\s*(\d{1,2})\s*[/-]\s*(\d{2,4})\s*$/);
  if (!match) {
    return { month: "", year: "" };
  }

  return {
    month: match[1].padStart(2, "0"),
    year: match[2],
  };
}

function createPayerNameTask(value: string): PaymentFieldTask {
  return {
    key: "payerName",
    label: "payer name",
    value,
    labelPatterns: [
      /payer\s*name/i,
      /person\s*who\s*is\s*paying/i,
      /name\s*of\s*the\s*person\s*who\s*is\s*paying/i,
    ],
    placeholderPatterns: [
      /payer\s*name/i,
      /name/i,
    ],
    selectors: [
      "input[name*='payer' i]",
      "input[id*='payer' i]",
      "input[name*='paymentname' i]",
      "input[id*='paymentname' i]",
      "input[name*='payment_name' i]",
      "input[id*='payment_name' i]",
      "input[aria-label*='payer name' i]",
      "input[placeholder*='payer name' i]",
    ],
  };
}

function createCardholderNameTask(value: string): PaymentFieldTask {
  return {
    key: "cardholderName",
    label: "cardholder name",
    value,
    labelPatterns: [
      /card\s*holder/i,
      /name\s*on\s*card/i,
      /card\s*owner/i,
    ],
    placeholderPatterns: [
      /card\s*holder/i,
      /name\s*on\s*card/i,
    ],
    selectors: [
      "input[autocomplete='cc-name']",
      "input[name*='cardholder' i]",
      "input[id*='cardholder' i]",
      "input[name*='card_holder' i]",
      "input[id*='card_holder' i]",
      "input[name*='nameoncard' i]",
      "input[id*='nameoncard' i]",
      "input[placeholder*='name on card' i]",
      "input[aria-label*='name on card' i]",
    ],
  };
}

function createCardNumberTask(value: string): PaymentFieldTask {
  return {
    key: "cardNumber",
    label: "card number",
    value,
    labelPatterns: [
      /card\s*number/i,
      /credit\s*card\s*number/i,
      /debit\s*card\s*number/i,
    ],
    placeholderPatterns: [
      /card\s*number/i,
      /1234/,
    ],
    selectors: [
      "input[autocomplete='cc-number']",
      "input[name*='cardnumber' i]",
      "input[id*='cardnumber' i]",
      "input[name*='card_number' i]",
      "input[id*='card_number' i]",
      "input[name*='cc-number' i]",
      "input[id*='cc-number' i]",
      "input[name*='pan' i]",
      "input[id*='pan' i]",
      "input[data-testid*='card-number' i]",
      "input[placeholder*='card number' i]",
      "input[aria-label*='card number' i]",
    ],
  };
}

function createExpiryTask(value: string): PaymentFieldTask {
  return {
    key: "expiry",
    label: "expiry date",
    value,
    labelPatterns: [
      /expir(?:y|ation)\s*date/i,
      /valid\s*(?:thru|through)/i,
    ],
    placeholderPatterns: [
      /mm\s*\/\s*yy/i,
      /mm\s*\/\s*yyyy/i,
      /expiry/i,
      /expiration/i,
    ],
    selectors: [
      "input[autocomplete='cc-exp']",
      "input[name*='expirydate' i]",
      "input[id*='expirydate' i]",
      "input[name*='expirationdate' i]",
      "input[id*='expirationdate' i]",
      "input[name*='expdate' i]",
      "input[id*='expdate' i]",
      "input[name*='cc-exp' i]",
      "input[id*='cc-exp' i]",
      "input[placeholder*='MM/YY' i]",
      "input[placeholder*='MM / YY' i]",
      "input[aria-label*='expiry date' i]",
      "input[aria-label*='expiration date' i]",
    ],
  };
}

function createExpiryMonthTask(value: string): PaymentFieldTask {
  const numeric = Number.parseInt(value, 10);
  const withoutLeadingZero = Number.isFinite(numeric) ? String(numeric) : value;
  return {
    key: "expiryMonth",
    label: "expiry month",
    value,
    selectValues: [value, withoutLeadingZero],
    labelPatterns: [
      /expir(?:y|ation)\s*month/i,
      /month/i,
    ],
    placeholderPatterns: [
      /^mm$/i,
      /month/i,
    ],
    selectors: [
      "select[autocomplete='cc-exp-month']",
      "input[autocomplete='cc-exp-month']",
      "select[name*='expirymonth' i]",
      "select[id*='expirymonth' i]",
      "input[name*='expirymonth' i]",
      "input[id*='expirymonth' i]",
      "select[name*='exp_month' i]",
      "select[id*='exp_month' i]",
      "input[name*='exp_month' i]",
      "input[id*='exp_month' i]",
      "select[name*='cc-exp-month' i]",
      "input[name*='cc-exp-month' i]",
    ],
  };
}

function createExpiryYearTask(value: string): PaymentFieldTask {
  const shortYear = value.length === 4 ? value.slice(2) : value;
  return {
    key: "expiryYear",
    label: "expiry year",
    value,
    selectValues: [value, shortYear],
    labelPatterns: [
      /expir(?:y|ation)\s*year/i,
      /year/i,
    ],
    placeholderPatterns: [
      /^yy(?:yy)?$/i,
      /year/i,
    ],
    selectors: [
      "select[autocomplete='cc-exp-year']",
      "input[autocomplete='cc-exp-year']",
      "select[name*='expiryyear' i]",
      "select[id*='expiryyear' i]",
      "input[name*='expiryyear' i]",
      "input[id*='expiryyear' i]",
      "select[name*='exp_year' i]",
      "select[id*='exp_year' i]",
      "input[name*='exp_year' i]",
      "input[id*='exp_year' i]",
      "select[name*='cc-exp-year' i]",
      "input[name*='cc-exp-year' i]",
    ],
  };
}

function createSecurityCodeTask(value: string): PaymentFieldTask {
  return {
    key: "securityCode",
    label: "security code",
    value,
    labelPatterns: [
      /security\s*code/i,
      /\bcvv\b/i,
      /\bcvc\b/i,
      /\bcsc\b/i,
    ],
    placeholderPatterns: [
      /security\s*code/i,
      /\bcvv\b/i,
      /\bcvc\b/i,
      /\bcsc\b/i,
    ],
    selectors: [
      "input[autocomplete='cc-csc']",
      "input[name*='securitycode' i]",
      "input[id*='securitycode' i]",
      "input[name*='security_code' i]",
      "input[id*='security_code' i]",
      "input[name*='cvv' i]",
      "input[id*='cvv' i]",
      "input[name*='cvc' i]",
      "input[id*='cvc' i]",
      "input[name*='csc' i]",
      "input[id*='csc' i]",
      "input[placeholder*='CVV' i]",
      "input[placeholder*='CVC' i]",
      "input[aria-label*='security code' i]",
    ],
  };
}

function createEmailTask(value: string): PaymentFieldTask {
  return {
    key: "email",
    label: "payment email",
    value,
    required: false,
    labelPatterns: [
      /email/i,
      /receipt\s*email/i,
    ],
    placeholderPatterns: [
      /email/i,
    ],
    selectors: [
      "input[type='email']",
      "input[autocomplete='email']",
      "input[name*='email' i]",
      "input[id*='email' i]",
    ],
  };
}

function createPostalCodeTask(value: string): PaymentFieldTask {
  return {
    key: "postalCode",
    label: "postal code",
    value,
    required: false,
    labelPatterns: [
      /postal\s*code/i,
      /post\s*code/i,
      /\bzip\b/i,
    ],
    placeholderPatterns: [
      /postal\s*code/i,
      /post\s*code/i,
      /\bzip\b/i,
    ],
    selectors: [
      "input[autocomplete='postal-code']",
      "input[name*='postal' i]",
      "input[id*='postal' i]",
      "input[name*='postcode' i]",
      "input[id*='postcode' i]",
      "input[name*='zip' i]",
      "input[id*='zip' i]",
    ],
  };
}

async function fillPaymentTaskAcrossPages(session: EngineSession, task: PaymentFieldTask) {
  const pages = session.context.pages()
    .filter((candidate) => !candidate.isClosed())
    .reverse();

  for (const page of pages) {
    if (await fillPaymentTaskInPage(page, task)) {
      session.page = page;
      process.stdout.write(`Filled payment field: ${task.label}\n`);
      return true;
    }
  }

  return false;
}

async function clickPaymentGatewayNavigation(
  session: EngineSession,
  clickedLabels: Set<string>,
) {
  const actions = [
    {
      key: "payNow",
      label: "PAY NOW",
      patterns: [/^pay\s*now$/i],
      selectors: [
        "input[type='submit' i][value='PAY NOW' i]",
        "input[type='button' i][value='PAY NOW' i]",
        "button:has-text('PAY NOW')",
        "a:has-text('PAY NOW')",
      ],
    },
    {
      key: "securePaymentSite",
      label: "Proceed to Secure Payment Site",
      patterns: [
        /^proceed\s+to\s+secure\s+payment\s+site$/i,
        /^secure\s+payment\s+site$/i,
      ],
      selectors: [
        "a:has-text('Proceed to Secure Payment Site')",
        "a:has-text('Secure Payment Site')",
        "button:has-text('Proceed to Secure Payment Site')",
        "input[type='submit' i][value='Proceed to Secure Payment Site' i]",
        "input[type='button' i][value='Proceed to Secure Payment Site' i]",
      ],
    },
  ];

  for (const action of actions) {
    if (clickedLabels.has(action.key)) {
      continue;
    }

    const clicked = await clickPaymentGatewayNavigationButton(session, action);
    if (clicked) {
      clickedLabels.add(action.key);
      process.stdout.write(`Clicked payment navigation button: ${action.label}.\n`);
      await sleep(500);
      return true;
    }
  }

  return false;
}

async function clickPaymentGatewayNavigationButton(
  session: EngineSession,
  action: { label: string; patterns: RegExp[]; selectors: string[] },
) {
  const pages = session.context.pages()
    .filter((candidate) => !candidate.isClosed())
    .reverse();

  for (const page of pages) {
    for (const frame of page.frames().slice().reverse()) {
      if (await clickPaymentGatewayNavigationInFrame(frame, action)) {
        session.page = page;
        return true;
      }
    }
  }

  return false;
}

async function clickPaymentGatewayNavigationInFrame(
  frame: Frame,
  action: { label: string; patterns: RegExp[]; selectors: string[] },
) {
  for (const pattern of action.patterns) {
    const locators = [
      frame.getByRole("button", { name: pattern }),
      frame.getByRole("link", { name: pattern }),
      frame.getByText(pattern),
    ];

    for (const locator of locators) {
      if (await clickFirstVisibleLocator(locator)) {
        return true;
      }
    }
  }

  for (const selector of action.selectors) {
    if (await clickFirstVisibleLocator(frame.locator(selector))) {
      return true;
    }
  }

  return false;
}

async function clickPaymentContinueButton(session: EngineSession) {
  const pages = session.context.pages()
    .filter((candidate) => !candidate.isClosed())
    .reverse();

  for (const page of pages) {
    for (const frame of page.frames().slice().reverse()) {
      const clicked = await clickFirstVisiblePaymentContinue(frame);
      if (clicked) {
        session.page = page;
        process.stdout.write("Clicked payment continue button to reach card details.\n");
        return true;
      }
    }
  }

  return false;
}

async function clickPaymentFinalPay(session: EngineSession, action: PhaseAction) {
  ensureFinalPaymentValuesConfigured(session);

  process.stdout.write("Waiting for the final payment Pay button.\n");

  const timeoutAt = Date.now() + (action.timeoutMs ?? 10 * 60 * 1000);
  const intervalMs = action.intervalMs ?? 1_000;

  while (Date.now() < timeoutAt) {
    if (await clickFinalPaymentPayButton(session)) {
      process.stdout.write("Clicked final payment button: Pay.\n");
      return;
    }

    await sleep(intervalMs);
  }

  throw new Error(
    "Timed out waiting for the final payment Pay button. " +
    "Leave the browser open and complete payment manually if the gateway layout changed.",
  );
}

function ensureFinalPaymentValuesConfigured(session: EngineSession) {
  const config = getPaymentCardConfig(session);
  const cardNumber = readPaymentValue(config, ["cardNumber", "number"]);
  const cardholderName = readPaymentValue(config, [
    "cardholderName",
    "cardHolderName",
    "nameOnCard",
    "name",
  ]);
  const securityCode = readPaymentValue(config, [
    "securityCode",
    "cvv",
    "cvc",
    "csc",
  ]);
  const expiry = readPaymentValue(config, ["expiry", "expiryDate", "expirationDate"]);
  const parsedExpiry = parseExpiryParts(expiry);
  const expiryMonth =
    readPaymentValue(config, ["expiryMonth", "expirationMonth", "month"]) ||
    parsedExpiry.month;
  const expiryYear =
    readPaymentValue(config, ["expiryYear", "expirationYear", "year"]) ||
    parsedExpiry.year;

  const missing = [
    ["card number", cardNumber],
    ["cardholder name", cardholderName],
    ["security code", securityCode],
    ["expiry month", expiry || expiryMonth],
    ["expiry year", expiry || expiryYear],
  ]
    .filter(([, value]) => !value)
    .map(([label]) => label);

  if (missing.length > 0) {
    throw new Error(
      `Final payment click requires configured payment value(s): ${missing.join(", ")}.`,
    );
  }
}

async function clickFinalPaymentPayButton(session: EngineSession) {
  const pages = session.context.pages()
    .filter((candidate) => !candidate.isClosed())
    .reverse();

  for (const page of pages) {
    if (!(await pageHasPaymentCardEntry(page))) {
      continue;
    }

    for (const frame of page.frames().slice().reverse()) {
      if (await clickFinalPaymentPayButtonInFrame(frame)) {
        session.page = page;
        return true;
      }
    }
  }

  return false;
}

async function pageHasPaymentCardEntry(page: Page) {
  for (const frame of page.frames().slice().reverse()) {
    if (await frameLooksLikePaymentCardEntry(frame)) {
      return true;
    }
  }

  return false;
}

async function frameLooksLikePaymentCardEntry(frame: Frame) {
  const indicators = [
    frame.getByText(/enter\s+card\s+details/i),
    frame.getByText(/paystation/i),
    frame.getByText(/\bnzd\b/i),
    frame.getByLabel(/card\s*number/i),
    frame.getByPlaceholder(/card\s*number/i),
    frame.getByLabel(/\bcsc\b/i),
    frame.getByPlaceholder(/\bcsc\b/i),
    frame.getByLabel(/cardholder\s*name/i),
    frame.getByPlaceholder(/cardholder\s*name/i),
    frame.locator("input[autocomplete='cc-number']"),
    frame.locator("input[autocomplete='cc-csc']"),
  ];

  let visibleIndicators = 0;
  for (const indicator of indicators) {
    if (await hasVisibleLocator(indicator)) {
      visibleIndicators += 1;
    }
  }

  return visibleIndicators >= 2;
}

async function clickFinalPaymentPayButtonInFrame(frame: Frame) {
  const locators = [
    frame.getByRole("button", { name: /^pay$/i }),
    frame.locator("button").filter({ hasText: /^pay$/i }),
    frame.locator("input[type='submit' i][value='Pay' i]"),
    frame.locator("input[type='button' i][value='Pay' i]"),
  ];

  for (const locator of locators) {
    if (await clickFirstVisibleLocator(locator)) {
      return true;
    }
  }

  return false;
}

async function clickFirstVisiblePaymentContinue(frame: Frame) {
  const locators = [
    frame.getByRole("button", { name: /^(ok|continue|next)$/i }),
    frame.locator("input[type='submit' i][value='OK' i], input[type='submit' i][value='Continue' i], input[type='submit' i][value='Next' i]"),
    frame.locator("input[type='button' i][value='OK' i], input[type='button' i][value='Continue' i], input[type='button' i][value='Next' i]"),
    frame.locator("button").filter({ hasText: /^(ok|continue|next)$/i }),
  ];

  for (const locator of locators) {
    if (await clickFirstVisibleLocator(locator)) {
      return true;
    }
  }

  return false;
}

async function hasVisibleLocator(locator: Locator) {
  const count = Math.min(await locator.count().catch(() => 0), 5);
  for (let index = 0; index < count; index += 1) {
    try {
      if (await locator.nth(index).isVisible()) {
        return true;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return false;
}

async function clickFirstVisibleLocator(locator: Locator) {
  const count = Math.min(await locator.count().catch(() => 0), 5);
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    try {
      if (await candidate.isVisible()) {
        await candidate.click({ timeout: 1_000 });
        return true;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return false;
}

async function fillPaymentTaskInPage(page: Page, task: PaymentFieldTask) {
  const frames = page.frames().slice().reverse();
  for (const frame of frames) {
    if (await fillPaymentTaskInFrame(frame, task)) {
      return true;
    }
  }

  return false;
}

async function fillPaymentTaskInFrame(frame: Frame, task: PaymentFieldTask) {
  for (const pattern of task.labelPatterns) {
    if (await fillFirstMatchingLocator(frame.getByLabel(pattern), task)) {
      return true;
    }
  }

  for (const pattern of task.placeholderPatterns) {
    if (await fillFirstMatchingLocator(frame.getByPlaceholder(pattern), task)) {
      return true;
    }
  }

  for (const selector of task.selectors) {
    if (await fillFirstMatchingLocator(frame.locator(selector), task)) {
      return true;
    }
  }

  return false;
}

async function fillFirstMatchingLocator(locator: Locator, task: PaymentFieldTask) {
  const count = Math.min(await locator.count().catch(() => 0), 5);
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (!(await isUsableFormControl(candidate))) {
      continue;
    }

    if (await setPaymentFieldValue(candidate, task)) {
      return true;
    }
  }

  return false;
}

async function isUsableFormControl(locator: Locator) {
  return await locator.evaluate((element) => {
    const control = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const type = "type" in control ? String(control.type).toLowerCase() : "";
    const style = window.getComputedStyle(control);
    const rect = control.getBoundingClientRect();
    return (
      type !== "hidden" &&
      !control.disabled &&
      !("readOnly" in control && control.readOnly) &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Boolean(rect.width || rect.height || control.getClientRects().length)
    );
  }).catch(() => false);
}

async function setPaymentFieldValue(locator: Locator, task: PaymentFieldTask) {
  await locator.scrollIntoViewIfNeeded({ timeout: 500 }).catch(() => undefined);
  const tagName = await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "");

  if (tagName === "select") {
    for (const option of task.selectValues ?? [task.value]) {
      try {
        await locator.selectOption(option, { timeout: 750 });
        return true;
      } catch {
        // Try the next common option representation.
      }
    }

    return false;
  }

  try {
    await locator.fill(task.value, { timeout: 1_000 });
    return true;
  } catch {
    // Some card gateways reject direct fill; fall back to keystrokes.
  }

  try {
    await locator.click({ timeout: 750 });
    await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await locator.pressSequentially(task.value, { delay: 5 });
    return true;
  } catch {
    return false;
  }
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

async function checkConfirmYesDeclarations(page: Page, requiredText: string) {
  if ((await page.locator(`text=${requiredText}`).count()) === 0) {
    process.stdout.write(`Confirm Submit text not found, skipping declaration auto-check.\n`);
    return;
  }

  const checkboxes = page.locator("input[type='checkbox']");
  const total = await checkboxes.count();

  for (let index = 0; index < total; index += 1) {
    const checkbox = checkboxes.nth(index);
    await clickConfirmCheckbox(page, index, checkbox);
  }

  const result = await page.evaluate(`
    (() => {
      const checkboxes = Array.from(document.querySelectorAll("input[type='checkbox']"));
      let checked = 0;
      for (const checkbox of checkboxes) {
        if (!checkbox.checked) {
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event("input", { bubbles: true }));
          checkbox.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (checkbox.checked) {
          checked += 1;
        }
      }
      return { checked, total: checkboxes.length };
    })()
  `) as { checked: number; total: number };

  process.stdout.write(`Checked ${result.checked}/${result.total} Confirm Submit Yes declaration checkbox(es).\n`);
}

async function clickConfirmCheckbox(
  page: Page,
  index: number,
  checkbox: ReturnType<Page["locator"]>,
) {
  try {
    if (await checkbox.isChecked()) {
      return;
    }
  } catch {
    // Fall through to coordinate clicking.
  }

  const point = await page.evaluate(`
    (() => {
      const checkbox = document.querySelectorAll("input[type='checkbox']")[${index}];
      if (!checkbox) {
        return null;
      }

      checkbox.scrollIntoView({ block: "center", inline: "center" });
      const checkboxRect = checkbox.getBoundingClientRect();
      if (checkboxRect.width > 0 && checkboxRect.height > 0) {
        return {
          x: checkboxRect.left + checkboxRect.width / 2,
          y: checkboxRect.top + checkboxRect.height / 2
        };
      }

      const label = checkbox.id
        ? document.querySelector("label[for='" + CSS.escape(checkbox.id) + "']")
        : checkbox.closest("label");
      if (label) {
        const labelRect = label.getBoundingClientRect();
        if (labelRect.width > 0 && labelRect.height > 0) {
          return {
            x: labelRect.left + Math.min(labelRect.width / 2, 20),
            y: labelRect.top + labelRect.height / 2
          };
        }
      }

      return null;
    })()
  `) as { x: number; y: number } | null;

  if (point) {
    await page.mouse.click(point.x, point.y);
    await sleep(80);
  }
}
