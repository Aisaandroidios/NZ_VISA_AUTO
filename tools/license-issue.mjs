import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLicensePayload, signLicensePayload } from "./license-lib.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const args = parseArgs(process.argv.slice(2));

const applicantPath = path.resolve(rootDir, args.applicant ?? "config/applicant.json");
const outPath = path.resolve(rootDir, args.out ?? "config/license.json");
const privateKeyPath = path.resolve(rootDir, args.privateKey ?? ".secrets/license-private.pem");
const licenseId = args.id ?? `lic_${randomUUID()}`;

const [applicant, privateKey] = await Promise.all([
  readJsonFile(applicantPath),
  readFile(privateKeyPath, "utf8"),
]);

const payload = createLicensePayload({
  applicant,
  licenseId,
  issuedAt: new Date().toISOString(),
  expiresAt: args.expiresAt,
});
const license = signLicensePayload(payload, privateKey);

await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(license, null, 2)}\n`, "utf8");

process.stdout.write(`License issued for applicant config:\n${applicantPath}\n`);
process.stdout.write(`License id:\n${licenseId}\n`);
process.stdout.write(`License file:\n${outPath}\n`);

function parseArgs(tokens) {
  const parsed = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];

    if (token === "--applicant" && next) {
      parsed.applicant = next;
      index += 1;
      continue;
    }
    if (token === "--out" && next) {
      parsed.out = next;
      index += 1;
      continue;
    }
    if (token === "--private-key" && next) {
      parsed.privateKey = next;
      index += 1;
      continue;
    }
    if (token === "--id" && next) {
      parsed.id = next;
      index += 1;
      continue;
    }
    if (token === "--expires-at" && next) {
      parsed.expiresAt = next;
      index += 1;
    }
  }
  return parsed;
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
