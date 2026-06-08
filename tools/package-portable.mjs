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
      "Running real China flow to manual final submit, then payment autofill and final Pay click...",
      "config/site.json",
    ),
    "utf8",
  );
  await writeFile(
    path.join(releaseDir, "run-test-pre-submit.bat"),
    windowsLauncher(
      "Running the single supported test flow (Germany) to manual final submit, then payment page autofill; final Pay is not clicked...",
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
    path.join(releaseDir, "download-dependencies.bat"),
    windowsDependencyDownloader(),
    "utf8",
  );

  await writeFile(
    path.join(releaseDir, "run-real-china-pre-submit.command"),
    unixLauncher(
      "Running real China flow to manual final submit, then payment autofill and final Pay click...",
      "config/site.json",
    ),
    "utf8",
  );
  await writeFile(
    path.join(releaseDir, "run-test-pre-submit.command"),
    unixLauncher(
      "Running the single supported test flow (Germany) to manual final submit, then payment page autofill; final Pay is not clicked...",
      "config/site.germany.json",
    ),
    "utf8",
  );
  await writeFile(
    path.join(releaseDir, "install-browser.command"),
    unixRuntimeInstaller(),
    "utf8",
  );
  await writeFile(
    path.join(releaseDir, "download-dependencies.command"),
    unixDependencyDownloader(),
    "utf8",
  );

  await chmod(path.join(releaseDir, "run-real-china-pre-submit.command"), 0o755);
  await chmod(path.join(releaseDir, "run-test-pre-submit.command"), 0o755);
  await chmod(path.join(releaseDir, "install-browser.command"), 0o755);
  await chmod(path.join(releaseDir, "download-dependencies.command"), 0o755);

  await writeFile(path.join(releaseDir, "PORTABLE-README.txt"), portableReadme(), "utf8");
  await writeFile(path.join(releaseDir, "WINDOWS-README.txt"), windowsReadme(), "utf8");
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

title NZ Visa Auto Run

cd /d "%~dp0"

echo NZ Visa Auto Run
echo This window will stay open if anything fails.
echo.

call :main
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" goto fail

echo.
echo The browser is configured to stay open for manual takeover.
echo Press any key to close this window.
pause >nul
exit /b 0

:main
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Please run install-browser.bat first.
  exit /b 1
)

if not exist "node_modules\\playwright" (
  echo Runtime dependencies were not found.
  echo Please run install-browser.bat first.
  exit /b 1
)

set "AUTO_CONTINUE_PAUSES=1"
set "KEEP_BROWSER_OPEN=1"

echo AUTO_CONTINUE_PAUSES=%AUTO_CONTINUE_PAUSES%
echo KEEP_BROWSER_OPEN=%KEEP_BROWSER_OPEN%
echo ${title}

node dist\\index.js run --site ${sitePath} --applicant config\\applicant.json
if errorlevel 1 exit /b %ERRORLEVEL%

exit /b 0

:fail
echo.
echo Run failed. Please check the error message above.
echo Press any key to close this window.
pause >nul
exit /b %EXIT_CODE%
`;
}

function windowsRuntimeInstaller() {
  return `@echo off
setlocal

title NZ Visa Runtime Installer

cd /d "%~dp0"

echo NZ Visa Runtime Installer
echo This window will stay open if anything fails.
echo.

echo Checking Node.js runtime...
call :ensure_node
if errorlevel 1 goto fail

call :refresh_path

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is still not available after installation.
  echo Please close this window, open a new Command Prompt, and run install-browser.bat again.
  goto fail
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm is still not available after installation.
  echo Please close this window, open a new Command Prompt, and run install-browser.bat again.
  goto fail
)

echo.
echo Node version:
node --version
echo npm version:
call npm --version

echo.
echo Installing production runtime dependencies...
call npm install --omit=dev
if errorlevel 1 goto fail

echo.
echo Installing Chromium for Playwright in this environment...
node node_modules\\playwright\\cli.js install chromium
if errorlevel 1 goto fail

echo.
echo Runtime install finished. You can now run run-test-pre-submit.bat or run-real-china-pre-submit.bat.
echo Press any key to close this window.
pause >nul
exit /b 0

:ensure_node
where node >nul 2>nul
if not errorlevel 1 (
  where npm >nul 2>nul
  if not errorlevel 1 exit /b 0
)

echo Node.js or npm was not found.
echo Trying to install Node.js LTS with Windows winget...
where winget >nul 2>nul
if errorlevel 1 (
  echo winget is not available on this computer.
  echo Please install Node.js LTS manually from https://nodejs.org/ and run this script again.
  start "" "https://nodejs.org/en/download"
  exit /b 1
)

winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo Node.js installation failed.
  exit /b 1
)

exit /b 0

:refresh_path
set "PATH=%ProgramFiles%\\nodejs;%AppData%\\npm;%PATH%"
exit /b 0

:fail
echo.
echo Environment install failed. Check the message above.
echo Press any key to close this window.
pause >nul
exit /b 1
`;
}

function windowsDependencyDownloader() {
  return `@echo off
setlocal

title NZ Visa Dependency Downloader

cd /d "%~dp0"

echo NZ Visa Dependency Downloader
echo This window will stay open if anything fails.
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo This script is for computers that already have Node.js.
  echo Please run install-browser.bat instead, or install Node.js first.
  echo Press any key to close this window.
  pause >nul
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found.
  echo Please run install-browser.bat instead, or reinstall Node.js.
  echo Press any key to close this window.
  pause >nul
  exit /b 1
)

echo Node version:
node --version
echo npm version:
call npm --version

echo.
echo Downloading production runtime dependencies...
call npm install --omit=dev
if errorlevel 1 goto fail

echo.
echo Downloading Chromium for Playwright...
node node_modules\\playwright\\cli.js install chromium
if errorlevel 1 goto fail

echo.
echo Dependencies are ready. You can now run the test or real flow script.
echo Press any key to close this window.
pause >nul
exit /b 0

:fail
echo.
echo Dependency download failed. Please check the error message above.
echo Press any key to close this window.
pause >nul
exit /b 1
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

function unixDependencyDownloader() {
  return `#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js or npm was not found."
  echo "This script is for computers that already have Node.js."
  echo "Please run install-browser.command instead, or install Node.js first."
  read -r -p "Press Enter to close this window..."
  exit 1
fi

echo "Node version:"
node --version
echo "npm version:"
npm --version

echo
echo "Downloading production runtime dependencies..."
npm install --omit=dev

echo
echo "Downloading Chromium for Playwright..."
node node_modules/playwright/cli.js install chromium

echo
read -r -p "Dependencies are ready. Press Enter to close this window..."
`;
}

function unixRuntimeInstaller() {
  return `#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

load_homebrew_path() {
  if [ -x "/opt/homebrew/bin/brew" ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x "/usr/local/bin/brew" ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

install_homebrew() {
  echo "Homebrew is not available. Installing Homebrew first..."
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is not available, so Homebrew cannot be downloaded automatically."
    echo "Please install Homebrew manually from https://brew.sh/ and run this script again."
    if command -v open >/dev/null 2>&1; then
      open "https://brew.sh/"
    fi
    read -r -p "Press Enter to close this window..."
    exit 1
  fi

  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  load_homebrew_path

  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew installation finished, but brew is not available in this shell yet."
    echo "Please close this window, open a new Terminal, and run install-browser.command again."
    read -r -p "Press Enter to close this window..."
    exit 1
  fi
}

load_homebrew_path

echo "Checking Node.js runtime..."
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js or npm was not found."

  if ! command -v brew >/dev/null 2>&1; then
    install_homebrew
  fi

  echo "Installing Node.js with Homebrew..."
  brew install node
  load_homebrew_path
fi

echo
echo "Node version:"
node --version
echo "npm version:"
npm --version

echo
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
1. Run install-browser.bat on Windows or install-browser.command on macOS once.
2. If Node.js is already installed, you may run download-dependencies.bat/.command instead.
3. The installer checks Node.js, installs dependencies, and installs Playwright Chromium.
4. Update config/applicant.json with the correct applicant and INZ login values if this is a template package.
5. Use run-test-pre-submit.* for the Germany rehearsal flow.
6. Use run-real-china-pre-submit.* for the real China flow.

Notes:
- Template packages intentionally use config/applicant.example.json as the portable config/applicant.json seed.
- Licensed packages include a signed config/applicant.json plus config/license.json.
- If config/security.json requires a license, changing locked applicant fields will stop the program.
- Germany test flow stops before the final Pay click.
- Final Submit is manual. China real flow fills payment details and clicks final Pay when payment values are configured.
- If CAPTCHA appears, solve it manually in the browser. The script will continue after it clears.
`;
}

function windowsReadme() {
  return `\uFEFFWindows 使用步骤 / Windows Quick Start

1. 先解压 zip，不要直接在压缩包里面运行。
   Extract the zip first. Do not run files from inside the zip preview.

2. 第一次使用，双击 install-browser.bat。
   First run: double-click install-browser.bat.

3. 如果电脑已经安装 Node.js，也可以双击 download-dependencies.bat，只下载依赖。
   If Node.js is already installed, you can double-click download-dependencies.bat to download dependencies only.

4. 如果电脑没有 Node.js，install-browser.bat 会尝试自动安装。
   如果 Windows 弹出安装确认，请点“是/允许/同意”。
   If Node.js is missing, the script will try to install it automatically.
   Approve the Windows installer prompts if they appear.

5. 安装完成后：
   德国测试：双击 run-test-pre-submit.bat
   中国真实：双击 run-real-china-pre-submit.bat

6. 如果窗口一闪就关，通常是没有先解压，或者被杀毒/系统策略拦截。
   新版本脚本会在出错时停住，请把窗口里的报错截图发给开发者。

7. 运行中如果出现验证码，在浏览器里手动完成验证码，程序会继续。
   If CAPTCHA appears, solve it manually in the browser. The script will continue.
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
