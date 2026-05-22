import { createHash, verify } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import type { ApplicantConfig } from "./config.js";

type SecurityConfig = {
  requireLicense?: boolean;
  licensePath?: string;
  publicKeyPath?: string;
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

export async function validateApplicantLicense(input: {
  applicant: ApplicantConfig;
  applicantPath: string;
}) {
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
  if (!security?.requireLicense && !hasLicenseFiles) {
    return;
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
  verifySignature(license, publicKey);
  verifyLockedApplicant(input.applicant, license);
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

function verifyLockedApplicant(applicant: ApplicantConfig, license: ApplicantLicense) {
  const actualLockedValues = collectLockedValues(applicant, license.lockedPaths);
  const actualHash = sha256(canonicalJson(actualLockedValues));

  if (actualHash !== license.lockedHash) {
    throw new Error(
      "Applicant information does not match this license. Reissue a license for the changed applicant.",
    );
  }
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
