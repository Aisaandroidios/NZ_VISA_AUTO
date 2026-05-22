import { chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import JavaScriptObfuscator from "javascript-obfuscator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const releaseBaseDir = path.join(rootDir, "release");
const releaseStamp = new Date().toISOString().replace(/[:.]/g, "-");
const releaseDir = path.join(releaseBaseDir, `portable-${releaseStamp}`);
const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const cliArgs = parseArgs(process.argv.slice(2));
const licensedPackage = cliArgs.licensed === true;

await main();

async function main() {
  await mkdir(releaseBaseDir, { recursive: true });

  await run(pnpmCmd, ["run", "build"], rootDir);
  await mkdir(releaseDir, { recursive: true });
  await cp(path.join(rootDir, "dist"), path.join(releaseDir, "dist"), { recursive: true });
  await obfuscateReleaseDist();
  await copyConfigForPortable({ licensed: licensedPackage });
  await cp(path.join(rootDir, "README.md"), path.join(releaseDir, "README.md"));
  await writeFile(
    path.join(releaseDir, "package.json"),
    JSON.stringify(runtimePackageJson(), null, 2),
    "utf8",
  );

  await writeFile(
    path.join(releaseDir, "run-real-china-pre-submit.bat"),
    windowsLauncher(
      "Running real China flow to the final manual submit handoff...",
      "config/site.json",
    ),
    "utf8",
  );
  await writeFile(
    path.join(releaseDir, "run-test-pre-submit.bat"),
    windowsLauncher(
      "Running the single supported test flow (Germany) to the final manual submit handoff...",
      "config/site.germany.json",
    ),
    "utf8",
  );
  await writeFile(
    path.join(releaseDir, "install-browser.bat"),
    windowsRuntimeInstaller(),
    "utf8",
  );

  await writeFile(
    path.join(releaseDir, "run-real-china-pre-submit.command"),
    unixLauncher(
      "Running real China flow to the final manual submit handoff...",
      "config/site.json",
    ),
    "utf8",
  );
  await writeFile(
    path.join(releaseDir, "run-test-pre-submit.command"),
    unixLauncher(
      "Running the single supported test flow (Germany) to the final manual submit handoff...",
      "config/site.germany.json",
    ),
    "utf8",
  );
  await writeFile(
    path.join(releaseDir, "install-browser.command"),
    unixRuntimeInstaller(),
    "utf8",
  );

  await chmod(path.join(releaseDir, "run-real-china-pre-submit.command"), 0o755);
  await chmod(path.join(releaseDir, "run-test-pre-submit.command"), 0o755);
  await chmod(path.join(releaseDir, "install-browser.command"), 0o755);

  await writeFile(path.join(releaseDir, "PORTABLE-README.txt"), portableReadme(), "utf8");
  await writeFile(path.join(releaseBaseDir, "LATEST-PORTABLE.txt"), `${releaseDir}\n`, "utf8");
  const archivePath = await createArchive(releaseDir);
  if (archivePath) {
    await writeFile(path.join(releaseBaseDir, "LATEST-PORTABLE-ZIP.txt"), `${archivePath}\n`, "utf8");
  }

  process.stdout.write(`\nPortable package created at:\n${releaseDir}\n`);
  if (archivePath) {
    process.stdout.write(`Portable zip created at:\n${archivePath}\n`);
  }
}

async function obfuscateReleaseDist() {
  const distDir = path.join(releaseDir, "dist");
  const jsFiles = await collectFiles(distDir, (filePath) => filePath.endsWith(".js"));
  for (const filePath of jsFiles) {
    const source = await readFile(filePath, "utf8");
    const obfuscated = JavaScriptObfuscator.obfuscate(source, {
      compact: true,
      controlFlowFlattening: false,
      deadCodeInjection: false,
      debugProtection: false,
      disableConsoleOutput: false,
      identifierNamesGenerator: "hexadecimal",
      log: false,
      renameGlobals: false,
      selfDefending: false,
      simplify: true,
      splitStrings: true,
      splitStringsChunkLength: 8,
      stringArray: true,
      stringArrayCallsTransform: true,
      stringArrayEncoding: ["base64"],
      stringArrayRotate: true,
      stringArrayShuffle: true,
      stringArrayThreshold: 0.85,
      target: "node",
    }).getObfuscatedCode();

    await writeFile(filePath, `${obfuscated}\n`, "utf8");
  }

  process.stdout.write(`Obfuscated ${jsFiles.length} compiled JavaScript file(s) for portable package.\n`);
}

async function collectFiles(directory, predicate) {
  const files = [];
  for (const entry of await readdir(directory)) {
    const fullPath = path.join(directory, entry);
    const entryStat = await stat(fullPath);
    if (entryStat.isDirectory()) {
      files.push(...await collectFiles(fullPath, predicate));
    } else if (predicate(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function copyConfigForPortable(options) {
  const sourceDir = path.join(rootDir, "config");
  const targetDir = path.join(releaseDir, "config");
  await copyDirFiltered(sourceDir, targetDir, (sourcePath) => {
    const name = path.basename(sourcePath).toLowerCase();
    if (name === "applicant.json") {
      return false;
    }
    if (!options.licensed && ["license.json", "license-public.pem", "security.json"].includes(name)) {
      return false;
    }
    return true;
  });

  if (options.licensed) {
    const applicantPath = path.resolve(rootDir, cliArgs.applicant ?? "config/applicant.json");
    const licensePath = path.resolve(rootDir, cliArgs.license ?? "config/license.json");
    const publicKeyPath = path.resolve(rootDir, cliArgs.publicKey ?? "config/license-public.pem");
    const securityPath = path.resolve(rootDir, cliArgs.security ?? "config/security.json");

    await assertFileExists(applicantPath, "licensed applicant config");
    await assertFileExists(licensePath, "applicant license");
    await assertFileExists(publicKeyPath, "license public key");
    await assertFileExists(securityPath, "security config");

    await cp(applicantPath, path.join(targetDir, "applicant.json"));
    await cp(licensePath, path.join(targetDir, "license.json"));
    await cp(publicKeyPath, path.join(targetDir, "license-public.pem"));
    await cp(securityPath, path.join(targetDir, "security.json"));
    return;
  }

  await cp(path.join(sourceDir, "applicant.example.json"), path.join(targetDir, "applicant.json"));
}

async function copyDirFiltered(sourceDir, targetDir, shouldCopy) {
  await mkdir(targetDir, { recursive: true });
  for (const entry of await readdir(sourceDir)) {
    const sourcePath = path.join(sourceDir, entry);
    if (!shouldCopy(sourcePath)) {
      continue;
    }

    const targetPath = path.join(targetDir, entry);
    const entryStat = await stat(sourcePath);
    if (entryStat.isDirectory()) {
      await copyDirFiltered(sourcePath, targetPath, shouldCopy);
    } else {
      await cp(sourcePath, targetPath);
    }
  }
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const spawnOptions = normalizeSpawnCommand(command, args);
    const child = spawn(spawnOptions.command, spawnOptions.args, {
      cwd,
      stdio: "inherit",
      shell: false,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code ?? "unknown"}.`));
      }
    });

    child.on("error", reject);
  });
}

function normalizeSpawnCommand(command, args) {
  if (process.platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args],
    };
  }

  return { command, args };
}

function windowsLauncher(title, sitePath) {
  return `@echo off
setlocal

cd /d "%~dp0"

set "AUTO_CONTINUE_PAUSES=1"
set "KEEP_BROWSER_OPEN=1"

echo AUTO_CONTINUE_PAUSES=%AUTO_CONTINUE_PAUSES%
echo KEEP_BROWSER_OPEN=%KEEP_BROWSER_OPEN%
echo ${title}

node dist\\index.js run --site ${sitePath} --applicant config\\applicant.json

echo.
echo The browser is configured to stay open for manual takeover.
echo Press any key to close this window.
pause >nul
`;
}

function windowsRuntimeInstaller() {
  return `@echo off
setlocal

cd /d "%~dp0"

echo Installing production runtime dependencies...
npm install --omit=dev

echo.
echo Installing Chromium for Playwright in this environment...
node node_modules\\playwright\\cli.js install chromium

echo.
echo Runtime install finished. Press any key to close this window.
pause >nul
`;
}

function unixLauncher(title, sitePath) {
  return `#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

export AUTO_CONTINUE_PAUSES=1
export KEEP_BROWSER_OPEN=1

echo "AUTO_CONTINUE_PAUSES=$AUTO_CONTINUE_PAUSES"
echo "KEEP_BROWSER_OPEN=$KEEP_BROWSER_OPEN"
echo "${title}"

node dist/index.js run --site ${sitePath} --applicant config/applicant.json

echo
echo "The browser is configured to stay open for manual takeover."
read -r -p "Press Enter to close this window..."
`;
}

function unixRuntimeInstaller() {
  return `#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Installing production runtime dependencies..."
npm install --omit=dev

echo
echo "Installing Chromium for Playwright in this environment..."
node node_modules/playwright/cli.js install chromium

echo
read -r -p "Runtime install finished. Press Enter to close this window..."
`;
}

function portableReadme() {
  return `NZ Visa Auto Push Portable Package

This folder is a runtime package. It contains compiled files in dist/ and does not require the original src/*.ts development sources.

Before running on a new machine:
1. Install Node.js.
2. Run install-browser.bat on Windows or install-browser.command on macOS once.
3. Update config/applicant.json with the correct applicant and INZ login values if this is a template package.
4. Use run-test-pre-submit.* for the Germany rehearsal flow.
5. Use run-real-china-pre-submit.* for the real China flow.

Notes:
- Template packages intentionally use config/applicant.example.json as the portable config/applicant.json seed.
- Licensed packages include a signed config/applicant.json plus config/license.json.
- If config/security.json requires a license, changing locked applicant fields will stop the program.
- The browser is intentionally left open for manual takeover at the final stage.
- Final legal government submission and payment remain manual.
- If CAPTCHA appears, solve it manually in the browser. The script will continue after it clears.
`;
}

function runtimePackageJson() {
  return {
    name: "nz-visa-auto-push-runtime",
    version: "0.1.0",
    private: true,
    type: "module",
    dependencies: {
      dotenv: "^16.4.5",
      playwright: "^1.52.0",
      zod: "^3.24.2",
    },
  };
}

async function createArchive(directory) {
  const archivePath = `${directory}.zip`;
  await rm(archivePath, { force: true });

  if (process.platform === "win32") {
    await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${directory}\\*' -DestinationPath '${archivePath}' -Force`,
      ],
      rootDir,
    );
    return archivePath;
  }

  await run("zip", ["-rq", archivePath, path.basename(directory)], path.dirname(directory));
  return archivePath;
}

function parseArgs(tokens) {
  const parsed = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];

    if (token === "--licensed") {
      parsed.licensed = true;
      continue;
    }
    if (token === "--applicant" && next) {
      parsed.applicant = next;
      index += 1;
      continue;
    }
    if (token === "--license" && next) {
      parsed.license = next;
      index += 1;
      continue;
    }
    if (token === "--public-key" && next) {
      parsed.publicKey = next;
      index += 1;
      continue;
    }
    if (token === "--security" && next) {
      parsed.security = next;
      index += 1;
    }
  }
  return parsed;
}

async function assertFileExists(filePath, label) {
  try {
    const entryStat = await stat(filePath);
    if (!entryStat.isFile()) {
      throw new Error(`${label} is not a file: ${filePath}`);
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Missing ${label}: ${filePath}`);
    }
    throw error;
  }
}
