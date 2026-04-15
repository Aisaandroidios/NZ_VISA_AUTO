import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { captureFailure, createSession, runPhase } from "./engine.js";
import type { LoadedConfig } from "./config.js";

export async function runSubmission(config: LoadedConfig) {
  const session = await createSession(config);
  const keepBrowserOpen = process.env.KEEP_BROWSER_OPEN === "1";

  try {
    if (config.site.phases.length > 0) {
      await runPhase(session, config.site.phases, "prepare");
    }

    if (config.site.submit.phase.length === 0) {
      process.stdout.write("\nNo submit phase configured. Preparation flow finished.\n");
      return;
    }

    if (config.site.submit.mode === "manual") {
      if (process.env.AUTO_CONTINUE_PAUSES === "1") {
        process.stdout.write(
          "\nPreparation complete. AUTO_CONTINUE_PAUSES=1, starting submit phase without terminal input.\n",
        );
      } else {
        await waitForEnter(
          "Preparation complete. Review the browser, then press Enter to run the final submit phase.\n",
        );
      }
    } else {
      const releaseAt = parseReleaseAt(config.site.submit.releaseAt);
      await waitUntil(releaseAt);
    }

    await runPhase(session, config.site.submit.phase, "submit");
    process.stdout.write("\nSubmit phase completed.\n");
  } catch (error) {
    await captureFailure(session);
    throw error;
  } finally {
    if (keepBrowserOpen) {
      process.stdout.write(
        "\nKEEP_BROWSER_OPEN=1, leaving the browser open. Close the browser window manually when you are done.\n",
      );
      try {
        await session.context.waitForEvent("close", { timeout: 24 * 60 * 60 * 1000 });
      } catch {
        // Best effort only. If the wait times out or the app exits, do not force-close the browser.
      }
    } else {
      await session.context.close();
    }
  }
}

async function waitForEnter(message: string) {
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question(message);
  } finally {
    rl.close();
  }
}

async function waitUntil(releaseAt: number) {
  const delay = releaseAt - Date.now();
  if (delay > 0) {
    process.stdout.write(`\nArmed until ${new Date(releaseAt).toISOString()}\n`);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

function parseReleaseAt(rawValue: string | undefined) {
  if (!rawValue) {
    throw new Error("submit.releaseAt is required when submit.mode is armed-auto.");
  }
  const parsed = new Date(rawValue).getTime();
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid submit.releaseAt: ${rawValue}`);
  }
  return parsed;
}
