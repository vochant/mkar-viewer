import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const artifactNames = ["libarchive.mjs", "libarchive.wasm", "NOTICE.txt"];
export const prebuiltDirectory = join(root, "wasm/libarchive/prebuilt");
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function sourceDigest() {
  const hash = createHash("sha256");
  for (const name of ["wasm/libarchive/sources.json", "wasm/libarchive/build.sh", "wasm/libarchive/build-dependencies.sh", "wasm/libarchive/build-libarchive.sh", "wasm/libarchive/writer.c", "wasm/libarchive/xxencode.c"]) {
    hash.update(name).update(readFileSync(join(root, name)));
  }
  return hash.digest("hex");
}

export function verifyArtifacts(directory = prebuiltDirectory) {
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  if (manifest.schema !== 1 || manifest.sourceSha256 !== sourceDigest()) throw new Error("libarchive prebuilt does not match its build sources; run npm run libarchive:rebuild");
  for (const name of artifactNames) {
    if (digest(readFileSync(join(directory, name))) !== manifest.files?.[name]) throw new Error(`libarchive prebuilt checksum mismatch: ${name}`);
  }
  return manifest;
}

export function publishArtifacts(source, provenance) {
  mkdirSync(prebuiltDirectory, { recursive: true });
  const files = Object.fromEntries(artifactNames.map((name) => [name, digest(readFileSync(join(source, name)))]));
  for (const name of artifactNames) copyFileSync(join(source, name), join(prebuiltDirectory, name));
  writeFileSync(join(prebuiltDirectory, "manifest.json"), `${JSON.stringify({ schema: 1, sourceSha256: sourceDigest(), files, ...provenance }, null, 2)}\n`);
  verifyArtifacts();
}

export function prepareArtifacts() {
  const manifest = verifyArtifacts();
  const destination = join(root, "src/generated/libarchive");
  mkdirSync(destination, { recursive: true });
  for (const name of artifactNames) {
    const target = join(destination, name);
    if (!existsSync(target) || digest(readFileSync(target)) !== manifest.files[name]) copyFileSync(join(prebuiltDirectory, name), target);
  }
  console.log(`libarchive: verified bundled WASM (${manifest.sourceSha256.slice(0, 12)}); no compilation`);
}
