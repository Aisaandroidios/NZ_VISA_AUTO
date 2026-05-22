import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const privateKeyPath = path.join(rootDir, ".secrets", "license-private.pem");
const publicKeyPath = path.join(rootDir, "config", "license-public.pem");

const { privateKey, publicKey } = generateKeyPairSync("ed25519");

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
  publicKey.export({ format: "pem", type: "spki" }),
  { encoding: "utf8", flag: "wx" },
).catch((error) => {
  if (error?.code === "EEXIST") {
    throw new Error(`Public key already exists: ${publicKeyPath}`);
  }
  throw error;
});

process.stdout.write(`License private key created at:\n${privateKeyPath}\n`);
process.stdout.write(`License public key created at:\n${publicKeyPath}\n`);
process.stdout.write("Keep .secrets/license-private.pem private. Do not send it to customers.\n");
