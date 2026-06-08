import { config as loadDotenv } from "dotenv";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  validateApplicantLicense,
  type LicenseGuard,
} from "./license.js";

loadDotenv();

const phaseActionSchema = z.object({
  name: z.string().min(1),
  action: z.enum([
    "goto",
    "waitFor",
    "waitForAny",
    "waitForOpen",
    "waitAndClickOpen",
    "waitForUrlChange",
    "click",
    "clickNoWait",
    "clickIfPresent",
    "clickIfPageTextContains",
    "fill",
    "fillIfPresent",
    "fillIfValue",
    "select",
    "selectIfValue",
    "selectVisibleYesRadios",
    "checkConfirmYesDeclarations",
    "fillPaymentCardDetails",
    "clickPaymentFinalPay",
    "check",
    "upload",
    "press",
    "sleep",
    "screenshot",
    "pause",
  ]),
  selector: z.string().optional(),
  selectors: z.array(z.string()).optional(),
  url: z.string().optional(),
  value: z.union([z.string(), z.array(z.string())]).optional(),
  path: z.string().optional(),
  key: z.string().optional(),
  message: z.string().optional(),
  text: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  timeoutMs: z.number().int().positive().optional(),
  intervalMs: z.number().int().positive().optional(),
  preActionDelayMs: z.number().int().nonnegative().optional(),
  postActionDelayMs: z.number().int().nonnegative().optional(),
  preReleaseIntervalMs: z.number().int().positive().optional(),
  finalCountdownWindowMs: z.number().int().nonnegative().optional(),
  finalCountdownIntervalMs: z.number().int().positive().optional(),
  hotCountdownWindowMs: z.number().int().nonnegative().optional(),
  hotCountdownIntervalMs: z.number().int().positive().optional(),
  clickTimeoutMs: z.number().int().positive().optional(),
  postClickWaitMs: z.number().int().nonnegative().optional(),
  reloadTimeoutMs: z.number().int().positive().optional(),
  releaseAt: z.string().optional(),
  reload: z.boolean().optional(),
  state: z.enum(["attached", "detached", "hidden", "visible"]).optional(),
  checked: z.boolean().optional(),
  fullPage: z.boolean().optional(),
  waitUntil: z
    .enum(["load", "domcontentloaded", "networkidle", "commit"])
    .optional(),
  urlIncludes: z.string().optional(),
  urlIncludesAny: z.array(z.string()).optional(),
  urlMatches: z.string().optional(),
});

const applicantSchema = z.object({
  profile: z.record(z.string(), z.any()).default({}),
  credentials: z.record(z.string(), z.any()).default({}),
  files: z.record(z.string(), z.any()).default({}),
  meta: z.record(z.string(), z.any()).default({}),
}).passthrough();

const siteSchema = z.object({
  name: z.string().min(1),
  timezone: z.string().optional(),
  browser: z
    .object({
      headless: z.boolean().default(false),
      slowMo: z.number().int().nonnegative().default(0),
      channel: z.string().optional(),
      userDataDir: z.string().default(".session/default"),
      viewport: z
        .object({
          width: z.number().int().positive(),
          height: z.number().int().positive(),
        })
        .default({ width: 1440, height: 960 }),
    })
    .default({}),
  urls: z.record(z.string(), z.any()).default({}),
  defaults: z
    .object({
      timeoutMs: z.number().int().positive().default(15000),
      navigationTimeoutMs: z.number().int().positive().default(30000),
      screenshotDir: z.string().default("artifacts"),
      defaultActionDelayMs: z.number().int().nonnegative().default(0),
      fieldDelayMs: z.number().int().nonnegative().default(0),
      clickDelayMs: z.number().int().nonnegative().default(0),
      navigationDelayMs: z.number().int().nonnegative().default(0),
    })
    .default({}),
  phases: z.array(phaseActionSchema).default([]),
  submit: z
    .object({
      mode: z.enum(["manual", "armed-auto"]).default("manual"),
      releaseAt: z.string().optional(),
      phase: z.array(phaseActionSchema).default([]),
    })
    .default({}),
});

export type PhaseAction = z.infer<typeof phaseActionSchema>;
export type ApplicantConfig = z.infer<typeof applicantSchema>;
export type SiteConfig = z.infer<typeof siteSchema>;

export type LoadedConfig = {
  applicant: ApplicantConfig;
  site: SiteConfig;
  applicantPath: string;
  sitePath: string;
  licenseGuard?: LicenseGuard;
};

export async function loadConfigFiles(input: {
  applicantPath: string;
  sitePath: string;
}): Promise<LoadedConfig> {
  const applicantPath = path.resolve(input.applicantPath);
  const sitePath = path.resolve(input.sitePath);
  const [applicantRaw, siteRaw] = await Promise.all([
    readJsonFile(applicantPath),
    readJsonFile(sitePath),
  ]);

  const applicant = applicantSchema.parse(applicantRaw);
  const site = siteSchema.parse(siteRaw);

  const licenseGuard = await validateApplicantLicense({ applicant, applicantPath });

  await mkdir(path.resolve(site.defaults.screenshotDir), { recursive: true });
  await mkdir(path.resolve(site.browser.userDataDir), { recursive: true });

  return {
    applicant,
    site,
    applicantPath,
    sitePath,
    licenseGuard,
  };
}

async function readJsonFile(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content);
}

export function parseCliArgs(argv: string[]) {
  const command = argv[2] ?? "run";
  let applicantPath = "config/applicant.json";
  let sitePath = "config/site.json";
  let watchMinutes = 30;

  for (let i = 3; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];

    if (token === "--applicant" && next) {
      applicantPath = next;
      i += 1;
      continue;
    }

    if (token === "--site" && next) {
      sitePath = next;
      i += 1;
      continue;
    }

    if (token === "--watch-minutes" && next) {
      watchMinutes = Number.parseInt(next, 10) || watchMinutes;
      i += 1;
    }
  }

  return {
    command,
    applicantPath,
    sitePath,
    watchMinutes,
  };
}

export function resolveTemplate<T>(value: T, context: Record<string, unknown>): T {
  if (typeof value === "string") {
    return interpolateString(value, context) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplate(item, context)) as T;
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = resolveTemplate(nestedValue, context);
    }
    return output as T;
  }

  return value;
}

function interpolateString(template: string, context: Record<string, unknown>) {
  const exactMatch = template.match(/^\$\{([^}]+)\}$/);
  if (exactMatch) {
    const exactValue = lookupPath(context, exactMatch[1]);
    if (exactValue !== undefined) {
      return exactValue;
    }
  }

  return template.replace(/\$\{([^}]+)\}/g, (_, expression) => {
    const resolved = lookupPath(context, expression.trim());
    if (resolved === undefined || resolved === null) {
      return "";
    }
    return String(resolved);
  });
}

function lookupPath(source: Record<string, unknown>, expression: string) {
  const parts = expression.split(".");
  let current: unknown = source;

  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
