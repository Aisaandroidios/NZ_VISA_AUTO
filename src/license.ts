import { createHash, verify } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import type { ApplicantConfig } from "./config.js";
import {
  builtInLicenseGuardSalt,
  builtInLicensePublicKeySha256,
} from "./license-builtins.js";

type SecurityConfig = {
  licensePath?: string;
  publicKeyPath?: string;
  publicKeySha256?: string;
};

type ApplicantLicense = {
  version: 1;
  algorithm: "ed25519";
  licenseId: string;
  issuedAt: string;
  expiresAt?: string;
  lockedPaths: string[];
  lockedValues: Record<string, unknown>;
  lockedHash: string;
  signature: string;
};

export type LicenseGuard = {
  licenseId: string;
  lockedHash: string;
  lockedPaths: string[];
  publicKeySha256: string;
  token: string;
  seal: string;
  checks: number;
};

export async function validateApplicantLicense(input: {
  applicant: ApplicantConfig;
  applicantPath: string;
}): Promise<LicenseGuard | undefined> {
  const applicantDir = path.dirname(input.applicantPath);
  const securityPath = path.join(applicantDir, "security.json");
  const security = await readOptionalJson<SecurityConfig>(securityPath);

  const licensePath = path.resolve(
    applicantDir,
    security?.licensePath ?? "license.json",
  );
  const publicKeyPath = path.resolve(
    applicantDir,
    security?.publicKeyPath ?? "license-public.pem",
  );

  const hasLicenseFiles =
    (await fileExists(licensePath)) || (await fileExists(publicKeyPath));
  const mustValidate = Boolean(
    builtInLicensePublicKeySha256 || security || hasLicenseFiles,
  );
  if (!mustValidate) {
    return undefined;
  }

  if (!(await fileExists(licensePath))) {
    throw new Error(`License is required but missing: ${licensePath}`);
  }
  if (!(await fileExists(publicKeyPath))) {
    throw new Error(`License public key is required but missing: ${publicKeyPath}`);
  }

  const [license, publicKey] = await Promise.all([
    readJsonFile<ApplicantLicense>(licensePath),
    readFile(publicKeyPath, "utf8"),
  ]);

  verifyLicenseShape(license);
  verifyExpiry(license);
  const publicKeySha256 = verifyPublicKey(publicKey, security);
  verifySignature(license, publicKey);
  verifyLockedApplicant(input.applicant, license);
  return createGuard(license, publicKeySha256);
}

export function assertRuntimeLicense(
  guard: LicenseGuard | undefined,
  reason: string,
) {
  if (!guard) {
    return;
  }

  guard.checks += 1;
  const seal = createGuardSeal(guard);
  if (seal !== guard.seal) {
    throw new Error(`License runtime guard failed during ${reason}.`);
  }

  if (guard.checks % 17 === 0) {
    const token = createGuardToken({
      licenseId: guard.licenseId,
      lockedHash: guard.lockedHash,
      lockedPaths: guard.lockedPaths,
      publicKeySha256: guard.publicKeySha256,
    });
    if (token !== guard.token) {
      throw new Error(`License runtime token failed during ${reason}.`);
    }
  }
}

export function assertApplicantRuntimeLicense(input: {
  applicant: ApplicantConfig;
  guard: LicenseGuard | undefined;
  reason: string;
}) {
  assertRuntimeLicense(input.guard, input.reason);
  if (!input.guard) {
    return;
  }

  const actualLockedValues = collectLockedValues(
    input.applicant,
    input.guard.lockedPaths,
  );
  const actualHash = sha256(canonicalJson(actualLockedValues));
  if (actualHash !== input.guard.lockedHash) {
    throw new Error(`Applicant license lock failed during ${input.reason}.`);
  }
}

function verifyLicenseShape(license: ApplicantLicense) {
  if (
    license.version !== 1 ||
    license.algorithm !== "ed25519" ||
    typeof license.licenseId !== "string" ||
    typeof license.issuedAt !== "string" ||
    !Array.isArray(license.lockedPaths) ||
    !license.lockedValues ||
    typeof license.lockedValues !== "object" ||
    typeof license.lockedHash !== "string" ||
    typeof license.signature !== "string"
  ) {
    throw new Error("Invalid applicant license format.");
  }
}

function verifyExpiry(license: ApplicantLicense) {
  if (!license.expiresAt) {
    return;
  }

  const expiresAt = new Date(license.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) {
    throw new Error(`Invalid license expiry date: ${license.expiresAt}`);
  }

  if (Date.now() > expiresAt) {
    throw new Error(`Applicant license expired at ${license.expiresAt}.`);
  }
}

function verifySignature(license: ApplicantLicense, publicKey: string) {
  const signedPayload = licensePayloadForSigning(license);
  const ok = verify(
    null,
    Buffer.from(canonicalJson(signedPayload), "utf8"),
    publicKey,
    Buffer.from(license.signature, "base64url"),
  );

  if (!ok) {
    throw new Error("Applicant license signature is invalid.");
  }
}

function verifyPublicKey(publicKey: string, security: SecurityConfig | undefined) {
  const publicKeySha256 = sha256(publicKey);

  if (security?.publicKeySha256 && security.publicKeySha256 !== publicKeySha256) {
    throw new Error("License public key hash does not match security config.");
  }

  if (
    builtInLicensePublicKeySha256 &&
    builtInLicensePublicKeySha256 !== publicKeySha256
  ) {
    throw new Error("License public key hash does not match this build.");
  }

  return publicKeySha256;
}

function verifyLockedApplicant(applicant: ApplicantConfig, license: ApplicantLicense) {
  const actualLockedValues = collectLockedValues(applicant, license.lockedPaths);
  const actualHash = sha256(canonicalJson(actualLockedValues));

  if (actualHash !== license.lockedHash) {
    throw new Error(decodeNotice(licenseMismatchNoticeParts));
  }
}

const licenseMismatchNoticeParts = [
  "a9c398b6969580af88a044231902577d592a01398ab7eaa2a4c79e9d8da2535220293c2f6d50151e",
  "c4888ae1a2d6d781bc9e73415434325d1a57772be5c3bc95b4c4c6e5b84341557e7f74494a2749bd",
  "f8f8c998efb5c1f6ca47576d6cc4d6aee5b5d536cae4afb1e0b5dff0b4be9dfc968692cf80e1b505",
  "25792a5b435d4b46dcfec3acfbaff59ae1940846331d731d2e1e2957b8cf95cbba9bf5eab3a06f1f",
  "6f10401842182d3ca7bbf0be91de94c4d9ec1f73247e1e620c325f4ccab29df1dce0cab8ca2b5010",
  "51760f64682d66e09697978293dca4e9a02e660e5f1471160e473e8cfaaae586f7c4fac2f34a3b1c",
  "6f3722186e4f48df80dbb4b5e1ecb9fe6c0d44491a1852766f3abab0c1bfcbc588b3c6af1c3c2a64",
  "357702525b3ae0b48afab1abdce780ce4b4c4a21776e606829189cd58b82eedba6e798d63b493652",
  "0d047b50",
];

function decodeNotice(parts: string[]) {
  const key = [0x4e, 0x5a, 0x31, 0x79, 0x0d, 0x63, 0x2a];
  const bytes = Buffer.from(parts.join(""), "hex");

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] ^= key[index % key.length] ^ ((index * 13) & 0xff);
  }

  return bytes.toString("utf8");
}

function licensePayloadForSigning(license: ApplicantLicense) {
  return {
    version: license.version,
    algorithm: license.algorithm,
    licenseId: license.licenseId,
    issuedAt: license.issuedAt,
    expiresAt: license.expiresAt,
    lockedPaths: license.lockedPaths,
    lockedValues: license.lockedValues,
    lockedHash: license.lockedHash,
  };
}

function createGuard(license: ApplicantLicense, publicKeySha256: string): LicenseGuard {
  const base = {
    licenseId: license.licenseId,
    lockedHash: license.lockedHash,
    lockedPaths: license.lockedPaths,
    publicKeySha256,
  };
  const token = createGuardToken(base);
  const guard: LicenseGuard = {
    ...base,
    token,
    seal: "",
    checks: 0,
  };
  guard.seal = createGuardSeal(guard);
  return guard;
}

function createGuardToken(input: {
  licenseId: string;
  lockedHash: string;
  lockedPaths: string[];
  publicKeySha256: string;
}) {
  return sha256(
    canonicalJson({
      licenseId: input.licenseId,
      lockedHash: input.lockedHash,
      lockedPaths: input.lockedPaths,
      publicKeySha256: input.publicKeySha256,
      salt: builtInLicenseGuardSalt,
    }),
  );
}

function createGuardSeal(guard: LicenseGuard) {
  return sha256(
    canonicalJson({
      licenseId: guard.licenseId,
      lockedHash: guard.lockedHash,
      lockedPaths: guard.lockedPaths,
      publicKeySha256: guard.publicKeySha256,
      token: guard.token,
      salt: builtInLicenseGuardSalt,
    }),
  );
}

function collectLockedValues(
  applicant: ApplicantConfig,
  lockedPaths: string[],
) {
  const output: Record<string, unknown> = {};
  for (const lockedPath of lockedPaths) {
    setPath(output, lockedPath, getPath(applicant, lockedPath));
  }
  return output;
}

function getPath(source: unknown, dottedPath: string) {
  let current = source;
  for (const part of dottedPath.split(".")) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current ?? null;
}

function setPath(target: Record<string, unknown>, dottedPath: string, value: unknown) {
  const parts = dottedPath.split(".");
  let current = target;

  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  current[parts[parts.length - 1]] = value;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const nested = (value as Record<string, unknown>)[key];
      if (nested !== undefined) {
        output[key] = canonicalize(nested);
      }
    }
    return output;
  }

  return value;
}

async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  if (!(await fileExists(filePath))) {
    return undefined;
  }
  return readJsonFile<T>(filePath);
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
