import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const privateKeyPath = path.join(rootDir, ".secrets", "license-private.pem");
const publicKeyPath = path.join(rootDir, "config", "license-public.pem");
const securityPath = path.join(rootDir, "config", "security.json");
const builtinsPath = path.join(rootDir, "src", "license-builtins.ts");

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
const publicKeySha256 = createHash("sha256").update(publicKeyPem).digest("hex");
const guardSalt = randomBytes(16).toString("hex");

await mkdir(path.dirname(privateKeyPath), { recursive: true });
await mkdir(path.dirname(publicKeyPath), { recursive: true });

await writeFile(
  privateKeyPath,
  privateKey.export({ format: "pem", type: "pkcs8" }),
  { encoding: "utf8", flag: "wx" },
).catch((error) => {
  if (error?.code === "EEXIST") {
    throw new Error(`Private key already exists: ${privateKeyPath}`);
  }
  throw error;
});

await writeFile(
  publicKeyPath,
  publicKeyPem,
  { encoding: "utf8", flag: "wx" },
).catch((error) => {
  if (error?.code === "EEXIST") {
    throw new Error(`Public key already exists: ${publicKeyPath}`);
  }
  throw error;
});

await writeFile(
  securityPath,
  `${JSON.stringify({
    licensePath: "license.json",
    publicKeyPath: "license-public.pem",
    publicKeySha256,
  }, null, 2)}\n`,
  "utf8",
);

await writeFile(
  builtinsPath,
  `export const builtInLicensePublicKeySha256 =\n  "${publicKeySha256}";\n\nexport const builtInLicenseGuardSalt =\n  "${guardSalt}";\n`,
  "utf8",
);

process.stdout.write(`License private key created at:\n${privateKeyPath}\n`);
process.stdout.write(`License public key created at:\n${publicKeyPath}\n`);
process.stdout.write(`License security config updated at:\n${securityPath}\n`);
process.stdout.write(`License build guard updated at:\n${builtinsPath}\n`);
process.stdout.write("Keep .secrets/license-private.pem private. Do not send it to customers.\n");
