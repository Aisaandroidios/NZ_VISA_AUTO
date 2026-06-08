import { createReadStream, createWriteStream } from "node:fs";
import { chmod, cp, lstat, mkdir, readFile, readlink, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import JavaScriptObfuscator from "javascript-obfuscator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const releaseBaseDir = path.join(rootDir, "release");
const cacheDir = path.join(releaseBaseDir, ".standalone-cache");
const releaseStamp = new Date().toISOString().replace(/[:.]/g, "-");
const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const cliArgs = parseArgs(process.argv.slice(2));
const licensedPackage = cliArgs.licensed !== false;

const targets = resolveTargets(cliArgs.target ?? "win64");

await main();

async function main() {
  await mkdir(releaseBaseDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  await run(pnpmCmd, ["run", "build"], rootDir);

  const outputs = [];
  for (const target of targets) {
    outputs.push(await buildTarget(target));
  }

  process.stdout.write("\nStandalone packages created:\n");
  for (const output of outputs) {
    process.stdout.write(`- ${output.target}: ${output.archivePath}\n`);
  }
}

async function buildTarget(target) {
  const releaseDir = path.join(releaseBaseDir, `standalone-${target}-${releaseStamp}`);

  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });
  await mkdir(path.join(releaseDir, "runtime"), { recursive: true });

  await cp(path.join(rootDir, "dist"), path.join(releaseDir, "dist"), { recursive: true });
  await obfuscateReleaseDist(releaseDir);
  await copyConfig(releaseDir, { licensed: licensedPackage });
  await cp(path.join(rootDir, "README.md"), path.join(releaseDir, "README.md"));
  await writeFile(path.join(releaseDir, "package.json"), JSON.stringify(runtimePackageJson(), null, 2), "utf8");

  await run(npmCmd, ["install", "--omit=dev", "--package-lock=false"], releaseDir, {
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
  });

  if (target === "win64") {
    await installWindowsRuntime(releaseDir);
    await writeWindowsLaunchers(releaseDir);
    await writeFile(path.join(releaseDir, "STANDALONE-README.txt"), standaloneReadme("Windows"), "utf8");
    const archivePath = await createZipArchive(releaseDir);
    await writeLatest(target, releaseDir, archivePath);
    return { target, releaseDir, archivePath };
  }

  await installMacRuntime(releaseDir, target);
  await writeMacLaunchers(releaseDir);
  await writeFile(path.join(releaseDir, "STANDALONE-README.txt"), standaloneReadme(`macOS ${target}`), "utf8");
  const archivePath = await createTarGzArchive(releaseDir);
  await writeLatest(target, releaseDir, archivePath);
  return { target, releaseDir, archivePath };
}

async function installWindowsRuntime(releaseDir) {
  await mkdir(path.join(releaseDir, "runtime", "node"), { recursive: true });
  await mkdir(path.join(releaseDir, "runtime", "ms-playwright"), { recursive: true });
  await cp(process.execPath, path.join(releaseDir, "runtime", "node", "node.exe"));
  await run(path.join(releaseDir, "runtime", "node", "node.exe"), [
    "node_modules\\playwright\\cli.js",
    "install",
    "chromium",
  ], releaseDir, {
    PLAYWRIGHT_BROWSERS_PATH: path.join(releaseDir, "runtime", "ms-playwright"),
  });
}

async function installMacRuntime(releaseDir, target) {
  const arch = target === "mac-arm64" ? "arm64" : "x64";
  const browserPlatform = arch === "arm64" ? "mac-arm64" : "mac-x64";
  const nodePlatform = `darwin-${arch}`;
  const nodeVersion = process.version;
  const nodeBase = `node-${nodeVersion}-${nodePlatform}`;
  const nodeArchive = await downloadCached(
    `https://nodejs.org/dist/${nodeVersion}/${nodeBase}.tar.gz`,
    `${nodeBase}.tar.gz`,
  );
  const nodeExtractDir = path.join(cacheDir, nodeBase);
  await rm(nodeExtractDir, { recursive: true, force: true });
  await mkdir(nodeExtractDir, { recursive: true });
  await run("tar", ["-xzf", nodeArchive, "-C", nodeExtractDir, `${nodeBase}/bin/node`], rootDir);
  await mkdir(path.join(releaseDir, "runtime", "node", "bin"), { recursive: true });
  await cp(
    path.join(nodeExtractDir, nodeBase, "bin", "node"),
    path.join(releaseDir, "runtime", "node", "bin", "node"),
  );

  const browsers = await readBrowsersJson(releaseDir);
  const chromium = browserDescriptor(browsers, "chromium");
  const headless = browserDescriptor(browsers, "chromium-headless-shell");
  const ffmpeg = browserDescriptor(browsers, "ffmpeg");
  const browserRoot = path.join(releaseDir, "runtime", "ms-playwright");
  await mkdir(browserRoot, { recursive: true });

  await downloadAndExtractZip(
    `https://cdn.playwright.dev/builds/cft/${chromium.browserVersion}/${browserPlatform}/chrome-${browserPlatform}.zip`,
    `chrome-${browserPlatform}-${chromium.browserVersion}.zip`,
    path.join(browserRoot, `chromium-${chromium.revision}`),
  );
  await markInstalled(path.join(browserRoot, `chromium-${chromium.revision}`));

  await downloadAndExtractZip(
    `https://cdn.playwright.dev/builds/cft/${headless.browserVersion}/${browserPlatform}/chrome-headless-shell-${browserPlatform}.zip`,
    `chrome-headless-shell-${browserPlatform}-${headless.browserVersion}.zip`,
    path.join(browserRoot, `chromium_headless_shell-${headless.revision}`),
  );
  await markInstalled(path.join(browserRoot, `chromium_headless_shell-${headless.revision}`));

  await downloadAndExtractZip(
    `https://cdn.playwright.dev/dbazure/download/playwright/builds/ffmpeg/${ffmpeg.revision}/ffmpeg-mac.zip`,
    `ffmpeg-mac-${ffmpeg.revision}.zip`,
    path.join(browserRoot, `ffmpeg-${ffmpeg.revision}`),
  );
  await markInstalled(path.join(browserRoot, `ffmpeg-${ffmpeg.revision}`));
}

async function writeWindowsLaunchers(releaseDir) {
  await writeFile(
    path.join(releaseDir, "run-test-pre-submit.bat"),
    windowsStandaloneLauncher(
      "Running the single supported test flow (Germany) to manual final submit, then payment page autofill; final Pay is not clicked...",
      "config/site.germany.json",
    ),
    "utf8",
  );
  await writeFile(
    path.join(releaseDir, "run-real-china-pre-submit.bat"),
    windowsStandaloneLauncher(
      "Running real China flow to manual final submit, then payment autofill and final Pay click...",
      "config/site.json",
    ),
    "utf8",
  );
  await writeFile(
    path.join(releaseDir, "run-real-taiwan-pre-submit.bat"),
    windowsStandaloneLauncher(
      "Running real Taiwan flow to manual final submit, then payment autofill and final Pay click...",
      "config/site.taiwan.json",
    ),
    "utf8",
  );
}

async function writeMacLaunchers(releaseDir) {
  await writeFile(
    path.join(releaseDir, "run-test-pre-submit.command"),
    macStandaloneLauncher(
      "Running the single supported test flow (Germany) to manual final submit, then payment page autofill; final Pay is not clicked...",
      "config/site.germany.json",
    ),
    "utf8",
  );
  await writeFile(
    path.join(releaseDir, "run-real-china-pre-submit.command"),
    macStandaloneLauncher(
      "Running real China flow to manual final submit, then payment autofill and final Pay click...",
      "config/site.json",
    ),
    "utf8",
  );
  await writeFile(
    path.join(releaseDir, "run-real-taiwan-pre-submit.command"),
    macStandaloneLauncher(
      "Running real Taiwan flow to manual final submit, then payment autofill and final Pay click...",
      "config/site.taiwan.json",
    ),
    "utf8",
  );
  await chmod(path.join(releaseDir, "run-test-pre-submit.command"), 0o755).catch(() => {});
  await chmod(path.join(releaseDir, "run-real-china-pre-submit.command"), 0o755).catch(() => {});
  await chmod(path.join(releaseDir, "run-real-taiwan-pre-submit.command"), 0o755).catch(() => {});
}

async function obfuscateReleaseDist(releaseDir) {
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

  process.stdout.write(`Obfuscated ${jsFiles.length} compiled JavaScript file(s) for ${path.basename(releaseDir)}.\n`);
}

async function copyConfig(releaseDir, options) {
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

async function readBrowsersJson(releaseDir) {
  const raw = await readFile(path.join(releaseDir, "node_modules", "playwright-core", "browsers.json"), "utf8");
  return JSON.parse(raw).browsers;
}

function browserDescriptor(browsers, name) {
  const descriptor = browsers.find((browser) => browser.name === name);
  if (!descriptor) {
    throw new Error(`Missing Playwright browser descriptor: ${name}`);
  }
  return descriptor;
}

async function downloadAndExtractZip(url, cacheName, destinationDir) {
  await rm(destinationDir, { recursive: true, force: true });
  await mkdir(destinationDir, { recursive: true });
  const archivePath = await downloadCached(url, cacheName);
  await run("tar", ["-xf", archivePath, "-C", destinationDir], rootDir);
}

async function downloadCached(url, cacheName) {
  const filePath = path.join(cacheDir, cacheName);
  try {
    const fileStat = await stat(filePath);
    if (fileStat.isFile() && fileStat.size > 0) {
      return filePath;
    }
  } catch {}

  process.stdout.write(`Downloading ${url}\n`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(filePath, bytes);
  return filePath;
}

async function markInstalled(directory) {
  await writeFile(path.join(directory, "INSTALLATION_COMPLETE"), "");
}

async function assertFileExists(filePath, label) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error(`${label} is not a file: ${filePath}`);
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`Missing ${label}: ${filePath}`);
    }
    throw error;
  }
}

function run(command, args, cwd, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const spawnOptions = normalizeSpawnCommand(command, args);
    const child = spawn(spawnOptions.command, spawnOptions.args, {
      cwd,
      env: { ...process.env, ...extraEnv },
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

function windowsStandaloneLauncher(title, sitePath) {
  return `@echo off
setlocal

title NZ Visa Standalone

cd /d "%~dp0"

echo NZ Visa Standalone
echo This window will stay open if anything fails.
echo.

if not exist "runtime\\node\\node.exe" (
  echo Bundled Node runtime was not found.
  echo Please extract the full standalone package again.
  pause
  exit /b 1
)

if not exist "runtime\\ms-playwright" (
  echo Bundled Playwright browser folder was not found.
  echo Please extract the full standalone package again.
  pause
  exit /b 1
)

set "PLAYWRIGHT_BROWSERS_PATH=%~dp0runtime\\ms-playwright"
set "NZVA_USE_BUNDLED_CHROMIUM=1"
set "AUTO_CONTINUE_PAUSES=1"
set "KEEP_BROWSER_OPEN=1"

echo Using bundled Node:
"%~dp0runtime\\node\\node.exe" --version
echo ${title}

"%~dp0runtime\\node\\node.exe" dist\\index.js run --site ${sitePath} --applicant config\\applicant.json
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Run failed. Please check the message above.
  pause
  exit /b %EXIT_CODE%
)

echo.
echo The browser is configured to stay open for manual takeover.
pause
exit /b 0
`;
}

function macStandaloneLauncher(title, sitePath) {
  return `#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

export PLAYWRIGHT_BROWSERS_PATH="$SCRIPT_DIR/runtime/ms-playwright"
export NZVA_USE_BUNDLED_CHROMIUM=1
export AUTO_CONTINUE_PAUSES=1
export KEEP_BROWSER_OPEN=1

xattr -dr com.apple.quarantine "$SCRIPT_DIR" 2>/dev/null || true
chmod +x "$SCRIPT_DIR/runtime/node/bin/node" 2>/dev/null || true
find "$SCRIPT_DIR/runtime/ms-playwright" -path "*/Contents/MacOS/*" -type f -exec chmod +x {} \\; 2>/dev/null || true
find "$SCRIPT_DIR/runtime/ms-playwright" -name "Google Chrome for Testing Framework" -type f -exec chmod +x {} \\; 2>/dev/null || true
find "$SCRIPT_DIR/runtime/ms-playwright" -name "*.dylib" -type f -exec chmod +x {} \\; 2>/dev/null || true
find "$SCRIPT_DIR/runtime/ms-playwright" -name "chrome_crashpad_handler" -type f -exec chmod +x {} \\; 2>/dev/null || true
find "$SCRIPT_DIR/runtime/ms-playwright" -name "chrome-headless-shell" -type f -exec chmod +x {} \\; 2>/dev/null || true

echo "Using bundled Node:"
"$SCRIPT_DIR/runtime/node/bin/node" --version
echo "${title}"

"$SCRIPT_DIR/runtime/node/bin/node" dist/index.js run --site ${sitePath} --applicant config/applicant.json

echo
read -r -p "The browser is configured to stay open for manual takeover. Press Enter to close this window..."
`;
}

function standaloneReadme(platformLabel) {
  return `NZ Visa Auto Push Standalone Package (${platformLabel})

This package includes:
- Bundled Node.js runtime
- Bundled production node_modules
- Bundled Playwright Chromium browser

No install-browser, download-dependencies, Node.js install, or npm install is required on the user computer.

Usage:
1. Extract the archive first. Do not run from inside archive preview.
2. Windows: double-click run-test-pre-submit.bat, run-real-china-pre-submit.bat, or run-real-taiwan-pre-submit.bat.
3. macOS: double-click run-test-pre-submit.command, run-real-china-pre-submit.command, or run-real-taiwan-pre-submit.command.

Notes:
- The package is intentionally large because it includes Chromium.
- If Windows blocks the first launch, choose More info, then Run anyway.
- If macOS blocks the first launch, right-click the .command file, choose Open, then confirm.
- If CAPTCHA appears, solve it manually in the browser. The script will continue.
- Germany test flow stops before the final Pay click.
- Final Submit is manual. China real flow fills payment details and clicks final Pay when payment values are configured.
`;
}

function runtimePackageJson() {
  return {
    name: "nz-visa-auto-push-standalone",
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

async function createZipArchive(directory) {
  const archivePath = `${directory}.zip`;
  await rm(archivePath, { force: true });
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

async function createTarGzArchive(directory) {
  const archivePath = `${directory}.tar.gz`;
  await rm(archivePath, { force: true });
  const archiveRoot = path.basename(directory);
  const gzip = createGzip({ level: 6 });
  const output = createWriteStream(archivePath);
  gzip.pipe(output);

  const entries = await collectArchiveEntries(directory);
  await writeTarHeader(gzip, `${archiveRoot}/`, { type: "directory", size: 0, mode: 0o755 });
  for (const entry of entries) {
    const archivePathName = `${archiveRoot}/${toPosix(entry.relativePath)}${entry.isDirectory ? "/" : ""}`;
    const mode = macArchiveMode(entry.relativePath, entry.isDirectory);
    await writeTarHeader(gzip, archivePathName, {
      type: entry.isDirectory ? "directory" : entry.isSymbolicLink ? "symlink" : "file",
      size: entry.isDirectory || entry.isSymbolicLink ? 0 : entry.size,
      mode,
      linkName: entry.linkName,
    });
    if (!entry.isDirectory && !entry.isSymbolicLink) {
      await writeFileToTar(gzip, entry.fullPath, entry.size);
    }
  }

  await writeStream(gzip, Buffer.alloc(1024));
  gzip.end();
  await new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    gzip.on("error", reject);
  });
  return archivePath;
}

async function collectArchiveEntries(directory, baseDir = directory) {
  const entries = [];
  for (const entry of await readdir(directory)) {
    const fullPath = path.join(directory, entry);
    const entryStat = await lstat(fullPath);
    const relativePath = path.relative(baseDir, fullPath);
    const isDirectory = entryStat.isDirectory();
    const isSymbolicLink = entryStat.isSymbolicLink();
    entries.push({
      fullPath,
      relativePath,
      isDirectory,
      isSymbolicLink,
      size: entryStat.size,
      linkName: isSymbolicLink ? await readlink(fullPath) : undefined,
    });
    if (isDirectory && !isSymbolicLink) {
      entries.push(...await collectArchiveEntries(fullPath, baseDir));
    }
  }
  return entries.sort((a, b) => toPosix(a.relativePath).localeCompare(toPosix(b.relativePath)));
}

async function writeTarHeader(stream, archivePathName, options) {
  const pathValue = toPosix(archivePathName);
  const linkValue = options.linkName ? toPosix(options.linkName) : undefined;
  if (Buffer.byteLength(pathValue) > 100 || (linkValue && Buffer.byteLength(linkValue) > 100)) {
    let paxData = paxRecord("path", pathValue);
    if (linkValue && Buffer.byteLength(linkValue) > 100) {
      paxData += paxRecord("linkpath", linkValue);
    }
    await writeRawTarHeader(stream, `PaxHeaders/${path.basename(pathValue).slice(0, 80)}`, {
      typeFlag: "x",
      mode: 0o644,
      size: Buffer.byteLength(paxData),
    });
    await writeStream(stream, Buffer.from(paxData));
    await writeTarPadding(stream, Buffer.byteLength(paxData));
  }

  await writeRawTarHeader(stream, pathValue, {
    typeFlag: options.type === "directory" ? "5" : options.type === "symlink" ? "2" : "0",
    mode: options.mode,
    size: options.size,
    linkName: linkValue,
  });
}

async function writeRawTarHeader(stream, name, options) {
  const header = Buffer.alloc(512, 0);
  const fallbackName = Buffer.byteLength(name) > 100 ? path.basename(name).slice(0, 100) : name;
  writeString(header, fallbackName, 0, 100);
  writeOctal(header, options.mode, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, options.size, 124, 12);
  writeOctal(header, Math.floor(Date.now() / 1000), 136, 12);
  header.fill(0x20, 148, 156);
  writeString(header, options.typeFlag, 156, 1);
  if (options.linkName) {
    writeString(header, options.linkName, 157, 100);
  }
  writeString(header, "ustar", 257, 6);
  writeString(header, "00", 263, 2);
  writeString(header, "root", 265, 32);
  writeString(header, "root", 297, 32);
  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  const checksumString = checksum.toString(8).padStart(6, "0");
  writeString(header, `${checksumString}\0 `, 148, 8);
  await writeStream(stream, header);
}

function writeString(buffer, value, offset, length) {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf8");
}

function writeOctal(buffer, value, offset, length) {
  const text = value.toString(8).padStart(length - 1, "0").slice(-(length - 1));
  writeString(buffer, `${text}\0`, offset, length);
}

function paxRecord(key, value) {
  let record = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(record) + 1;
  while (true) {
    const next = `${length}${record}`;
    const nextLength = Buffer.byteLength(next);
    if (nextLength === length) {
      return next;
    }
    length = nextLength;
  }
}

async function writeFileToTar(stream, filePath, size) {
  const input = createReadStream(filePath);
  for await (const chunk of input) {
    await writeStream(stream, chunk);
  }
  await writeTarPadding(stream, size);
}

async function writeTarPadding(stream, size) {
  const remainder = size % 512;
  if (remainder !== 0) {
    await writeStream(stream, Buffer.alloc(512 - remainder));
  }
}

function writeStream(stream, chunk) {
  return new Promise((resolve, reject) => {
    const ok = stream.write(chunk, (error) => {
      if (error) {
        reject(error);
      }
    });
    if (ok) {
      resolve();
    } else {
      stream.once("drain", resolve);
    }
  });
}

function macArchiveMode(relativePath, isDirectory) {
  if (isDirectory) {
    return 0o755;
  }

  const normalized = toPosix(relativePath);
  const basename = path.posix.basename(normalized);
  if (
    normalized.endsWith(".command") ||
    normalized === "runtime/node/bin/node" ||
    normalized.includes(".app/Contents/MacOS/") ||
    (normalized.startsWith("runtime/ms-playwright/") && normalized.endsWith(".dylib")) ||
    normalized.endsWith("/ffmpeg-mac") ||
    basename === "chrome_crashpad_handler" ||
    basename === "chrome-wrapper" ||
    basename === "Google Chrome for Testing" ||
    basename.endsWith(" Framework") ||
    basename === "chrome-headless-shell"
  ) {
    return 0o755;
  }

  return 0o644;
}

function toPosix(input) {
  return input.replace(/\\/g, "/");
}

async function writeLatest(target, releaseDir, archivePath) {
  const name = target.toUpperCase().replace(/-/g, "-");
  await writeFile(path.join(releaseBaseDir, `LATEST-STANDALONE-${name}.txt`), `${releaseDir}\n`, "utf8");
  await writeFile(path.join(releaseBaseDir, `LATEST-STANDALONE-${name}-ARCHIVE.txt`), `${archivePath}\n`, "utf8");
  if (archivePath.endsWith(".zip")) {
    await writeFile(path.join(releaseBaseDir, `LATEST-STANDALONE-${name}-ZIP.txt`), `${archivePath}\n`, "utf8");
  }
}

function resolveTargets(rawTarget) {
  const value = String(rawTarget).toLowerCase();
  if (value === "all") {
    return ["win64", "mac-arm64", "mac-x64"];
  }
  if (["win64", "mac-arm64", "mac-x64"].includes(value)) {
    return [value];
  }
  throw new Error(`Unsupported standalone target "${rawTarget}". Use win64, mac-arm64, mac-x64, or all.`);
}

function parseArgs(args) {
  const parsed = {};
  for (const arg of args) {
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, ...rawValue] = arg.slice(2).split("=");
    const key = rawKey.trim();
    const value = rawValue.length > 0 ? rawValue.join("=") : true;
    if (value === "true") {
      parsed[key] = true;
    } else if (value === "false") {
      parsed[key] = false;
    } else {
      parsed[key] = value;
    }
  }
  return parsed;
}
