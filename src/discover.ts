import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { LoadedConfig } from "./config.js";
import { captureFailure, createSession } from "./engine.js";

const SNAPSHOT_SCRIPT = String.raw`
(() => {
  function normalize(value) {
    return value == null ? "" : String(value).trim();
  }

  function collectLabel(el) {
    const byFor = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
    if (byFor) {
      return normalize(byFor.textContent);
    }

    const wrappingLabel = el.closest("label");
    if (wrappingLabel) {
      return normalize(wrappingLabel.textContent);
    }

    const container = el.closest("tr, td, .form-group, .question, div");
    const firstLabel = container ? container.querySelector("label") : null;
    return normalize(firstLabel ? firstLabel.textContent : "");
  }

  const controls = Array.from(document.querySelectorAll("input, select, textarea, button")).map(function (node) {
    const el = node;
    const isSelect = el.tagName.toLowerCase() === "select";
    const options = isSelect
      ? Array.from(el.options).map(function (option) {
          return {
            text: option.text.trim(),
            value: option.value,
            selected: option.selected
          };
        })
      : [];

    return {
      tag: el.tagName.toLowerCase(),
      type: "type" in el ? (el.type || "") : "",
      id: el.id || "",
      name: "name" in el ? (el.name || "") : "",
      label: collectLabel(el),
      value: "value" in el ? String(el.value || "") : "",
      placeholder: "placeholder" in el ? (el.placeholder || "") : "",
      checked: "checked" in el ? Boolean(el.checked) : undefined,
      disabled: Boolean(el.disabled),
      required: Boolean(el.matches(":required")),
      visible: !!el.offsetParent || getComputedStyle(el).position === "fixed",
      options: options
    };
  });

  const links = Array.from(document.querySelectorAll("a"))
    .map(function (anchor) {
      return {
        text: normalize(anchor.textContent),
        href: anchor.href,
        id: anchor.id || ""
      };
    })
    .filter(function (item) {
      return Boolean(item.text || item.id);
    });

  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .map(function (heading) {
      return normalize(heading.textContent);
    })
    .filter(function (value) {
      return Boolean(value);
    });

  const hasCaptcha = Boolean(
    document.querySelector("#g-recaptcha-response, iframe[src*='recaptcha'], form[action*='captcha'], .g-recaptcha")
  );

  return {
    url: location.href,
    title: document.title,
    headings: headings,
    hasCaptcha: hasCaptcha,
    controls: controls,
    links: links
  };
})()
`;

export async function runDiscovery(config: LoadedConfig, watchMinutes = 30) {
  const session = await createSession({
    ...config,
    site: {
      ...config.site,
      browser: {
        ...config.site.browser,
        userDataDir: `${config.site.browser.userDataDir}-discover`,
      },
    },
  });
  const screenshotDir = path.resolve(config.site.defaults.screenshotDir);
  const timeoutAt = Date.now() + watchMinutes * 60_000;
  let lastKey = "";

  try {
    await ensureEntryVisible(session.page, config);
    await bootstrapFlow(session.page, config);
    process.stdout.write(
      `\nDiscovery mode active for up to ${watchMinutes} minute(s). ` +
        "Continue the real flow in the visible browser. " +
        "Every page change will be captured automatically.\n",
    );

    while (Date.now() < timeoutAt) {
      if (session.page.isClosed()) {
        process.stdout.write("\nBrowser page closed. Discovery finished.\n");
        return;
      }

      const url = session.page.url();
      const title = await session.page.title().catch(() => "");
      const key = `${url}|${title}`;

      if (key !== lastKey) {
        lastKey = key;
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        await mkdir(screenshotDir, { recursive: true });
        const screenshotPath = path.join(screenshotDir, `discover-${stamp}.png`);
        const jsonPath = path.join(screenshotDir, `discover-${stamp}.json`);
        await session.page.screenshot({ path: screenshotPath, fullPage: true });
        const snapshot = await session.page.evaluate(SNAPSHOT_SCRIPT);
        await writeFile(jsonPath, JSON.stringify(snapshot, null, 2), "utf8");
        process.stdout.write(`\nCaptured ${url}\n  ${screenshotPath}\n  ${jsonPath}\n`);
      }

      await session.page.waitForTimeout(1500);
    }

    process.stdout.write("\nDiscovery timeout reached.\n");
  } catch (error) {
    await captureFailure(session, "discover");
    throw error;
  } finally {
    if (!session.page.isClosed()) {
      await session.context.close();
    }
  }
}

async function ensureEntryVisible(page: Awaited<ReturnType<typeof createSession>>["page"], config: LoadedConfig) {
  const currentUrl = page.url();
  if (currentUrl && currentUrl !== "about:blank") {
    return;
  }

  await page.goto(config.site.urls.login, { waitUntil: "domcontentloaded" });
}

async function bootstrapFlow(
  page: Awaited<ReturnType<typeof createSession>>["page"],
  config: LoadedConfig,
) {
  const credentials = config.applicant.credentials;

  if (!page.url().includes("immigration.govt.nz")) {
    await page.goto(config.site.urls.login, { waitUntil: "domcontentloaded" });
  }

  const username = page.locator("input[name='username']");
  const password = page.locator("input[name='password']");
  if (
    (await username.count()) > 0 &&
    (await password.count()) > 0 &&
    typeof credentials.email === "string" &&
    typeof credentials.password === "string"
  ) {
    await username.fill(credentials.email);
    await password.fill(credentials.password);
    await page.locator("input[type='submit']").click();
    await page.waitForTimeout(3000);
  }

  if (typeof config.site.urls.holding === "string") {
    await page.goto(config.site.urls.holding, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
  }

  if (page.url().includes("access-denied") && String(config.site.urls.holding).includes("CountryId=46")) {
    await page.goto(
      "https://onlineservices.immigration.govt.nz/WorkingHoliday/Application/Create.aspx?CountryId=24&OffShore=1&STZ=0",
      { waitUntil: "domcontentloaded" },
    );
    await page.waitForTimeout(2000);
  }

  const applyNow = page.locator("#ContentPlaceHolder1_applyNowButton");
  if ((await applyNow.count()) > 0) {
    await applyNow.click();
    await page.waitForTimeout(3000);
  }
}
