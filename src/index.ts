import { loadConfigFiles, parseCliArgs } from "./config.js";
import { runDiscovery } from "./discover.js";
import { runSubmission } from "./submit.js";

async function main() {
  const args = parseCliArgs(process.argv);

  const config = await loadConfigFiles({
    applicantPath: args.applicantPath,
    sitePath: args.sitePath,
  });

  if (args.command === "run") {
    await runSubmission(config);
    return;
  }

  if (args.command === "discover") {
    await runDiscovery(config, args.watchMinutes);
    return;
  }

  throw new Error(`Unsupported command "${args.command}". Supported commands: "run", "discover".`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
