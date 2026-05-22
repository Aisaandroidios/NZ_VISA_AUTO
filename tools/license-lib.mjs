import { createHash, sign } from "node:crypto";

export const defaultLockedPaths = [
  "profile.familyName",
  "profile.givenName",
  "profile.givenName2",
  "profile.givenName3",
  "profile.otherNames",
  "profile.dateOfBirth",
];

export function createLicensePayload(input) {
  const lockedPaths = input.lockedPaths ?? defaultLockedPaths;
  const lockedValues = collectLockedValues(input.applicant, lockedPaths);
  const lockedHash = sha256(canonicalJson(lockedValues));

  return {
    version: 1,
    algorithm: "ed25519",
    licenseId: input.licenseId,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    lockedPaths,
    lockedValues,
    lockedHash,
  };
}

export function signLicensePayload(payload, privateKey) {
  const signature = sign(
    null,
    Buffer.from(canonicalJson(payload), "utf8"),
    privateKey,
  ).toString("base64url");

  return {
    ...payload,
    signature,
  };
}

export function collectLockedValues(applicant, lockedPaths) {
  const output = {};
  for (const lockedPath of lockedPaths) {
    setPath(output, lockedPath, getPath(applicant, lockedPath));
  }
  return output;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      const nested = value[key];
      if (nested !== undefined) {
        output[key] = canonicalize(nested);
      }
    }
    return output;
  }

  return value;
}

function getPath(source, dottedPath) {
  let current = source;
  for (const part of dottedPath.split(".")) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return null;
    }
    current = current[part];
  }
  return current ?? null;
}

function setPath(target, dottedPath, value) {
  const parts = dottedPath.split(".");
  let current = target;

  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
