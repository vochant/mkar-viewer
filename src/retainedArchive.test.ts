import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import * as wasm from "./generated/remkar-wasm/remkar_wasm";
import { loadMkarCodec } from "./mkarCodec";
import { encodeArchive } from "./archive";
import type { FsEntry } from "./types";

const directory = mkdtempSync(join(tmpdir(), "mkar-retained-archive-test-"));
const entries: FsEntry[] = [
  { id: "folder", name: "empty", path: "empty", kind: "folder" },
  { id: "text", name: "中文.txt", path: "nested/中文.txt", kind: "file", content: new TextEncoder().encode("你好, archive\n") },
  { id: "zero", name: "zero", path: "zero", kind: "file", content: new Uint8Array() },
  { id: "binary", name: "binary", path: "binary", kind: "file", content: Buffer.concat(Array.from({ length: 4096 }, (_, index) => createHash("sha256").update(`fixture-${index}`).digest())) },
];

beforeAll(() => {
  const exports = wasm.initSync({ module: readFileSync(new URL("./generated/remkar-wasm/remkar_wasm_bg.wasm", import.meta.url)) });
  vi.spyOn(wasm, "default").mockResolvedValue(exports);
});

afterAll(() => {
  vi.restoreAllMocks();
  console.log(`Retained archive interoperability fixtures retained at ${directory}`);
});

describe("production codec retained writers", () => {
  it.each(["ar", "cab"] as const)("exports readable %s through the loaded WASM codec", async (format) => {
    const codec = await loadMkarCodec();
    const bytes = await encodeArchive(format, entries, codec);
    const signature = format === "ar" ? "!<arch>\n" : "MSCF";
    expect(new TextDecoder().decode(bytes.slice(0, signature.length))).toBe(signature);
    const path = join(directory, `export.${format}`);
    writeFileSync(path, bytes);
    const listing = spawnSync("bsdtar", ["-tf", path], { encoding: "utf8" });
    expect(listing.error).toBeUndefined();
    expect(listing.status, listing.stderr).toBe(0);
    const files = entries.filter((entry) => entry.kind === "file");
    const paths = listing.stdout.trimEnd().split("\n");
    expect(paths.map((name) => name.replaceAll("\\", "/")).sort()).toEqual(files.map((entry) => entry.path).sort());
    for (const entry of files) {
      const storedPath = paths.find((name) => name.replaceAll("\\", "/") === entry.path)!;
      const extracted = spawnSync("bsdtar", ["-xOf", path, storedPath]);
      expect(extracted.status, extracted.stderr?.toString()).toBe(0);
      expect(Buffer.from(extracted.stdout)).toEqual(Buffer.from(entry.content!));
    }
  });
});
