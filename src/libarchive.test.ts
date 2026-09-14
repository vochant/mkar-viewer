import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import createModule from "./generated/libarchive/libarchive.mjs";
import { prepareArchiveEntries, type StandardArchiveFormat } from "./libarchive";
import { writeStandardArchive, type LibarchiveModule } from "./libarchiveRuntime";
import type { FsEntry } from "./types";

const directory = mkdtempSync(join(tmpdir(), "mkar-libarchive-test-"));
let module: LibarchiveModule;
const binary = Buffer.concat(Array.from({ length: 4096 }, (_, index) => createHash("sha256").update(`fixture-${index}`).digest()));
const input: FsEntry[] = [
  { id: "1", name: "empty", path: "empty", kind: "folder" },
  { id: "2", name: "中文.txt", path: "root/中文.txt", kind: "file", content: new TextEncoder().encode("你好, libarchive\n") },
  { id: "3", name: "zero", path: "zero", kind: "file", content: new Uint8Array() },
  { id: "4", name: "binary", path: "binary", kind: "file", content: binary },
];
const prepared = prepareArchiveEntries(input);

beforeAll(async () => {
  module = await createModule({ wasmBinary: readFileSync(new URL("./generated/libarchive/libarchive.wasm", import.meta.url)) });
});
afterAll(() => console.log(`Archive interoperability fixtures retained at ${directory}`));

function verify(format: StandardArchiveFormat, bytes: Uint8Array, expected = prepared) {
  const path = join(directory, `${format}-${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`);
  writeFileSync(path, bytes);
  const listing = spawnSync("bsdtar", ["-tf", path], { encoding: "utf8" });
  expect(listing.error).toBeUndefined();
  expect(listing.status, listing.stderr).toBe(0);
  expect(listing.stdout.trimEnd().split("\n").map((name) => name.replace(/\/$/, "").replace(/^\.$/, "")).filter(Boolean).sort()).toEqual(expected.map((entry) => entry.path).sort());
  const details = spawnSync("bsdtar", ["-tvf", path], { encoding: "utf8" });
  expect(details.status, details.stderr).toBe(0);
  for (const entry of expected) {
    if (entry.kind === "folder") {
      expect(details.stdout.split("\n").some((line) => line.startsWith("d") && line.replace(/\/$/, "").endsWith(` ${entry.path}`))).toBe(true);
    } else {
      const extracted = spawnSync("bsdtar", ["-xOf", path, entry.path]);
      expect(extracted.status, extracted.stderr?.toString()).toBe(0);
      expect(Buffer.from(extracted.stdout)).toEqual(Buffer.from(entry.content));
    }
  }
  if (["xar", "7z", "zip"].includes(format)) {
    const result = spawnSync("7z", ["t", path], { encoding: "utf8" });
    expect(result.status, result.error?.message ?? result.stdout + result.stderr).toBe(0);
  }
}

describe("compiled libarchive writer", () => {
  it.each(["zip", "7z", "cpio", "xar", "iso", "tar", "tar.gz", "tar.bz2", "tar.xz", "tar.zst", "tar.lz4", "tar.lzma", "tar.lz", "tar.Z", "tar.uu", "tar.b64"] as const)("writes non-empty interoperable %s", (format) => {
    const bytes = writeStandardArchive(module, format, prepared, { variant: "gnu" });
    expect(bytes.byteLength).toBeGreaterThan(0);
    verify(format, bytes);
  });
  it.each(["shar", "tar.xx"] as const)("writes non-empty textual %s", (format) => {
    const bytes = writeStandardArchive(module, format, prepared, { variant: "gnu" });
    expect(bytes.byteLength).toBeGreaterThan(0);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain(format === "shar" ? "#!/bin/sh" : "begin 644 -\n");
  });
  it("writes xxencode with the required header newline and zero line", () => {
    const bytes = writeStandardArchive(module, "tar.xx", prepared, { variant: "gnu" });
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith("begin 644 -\n")).toBe(true);
    expect(text).toContain("\n+\nend\n");
  });
  it("does not apply uuencode zero-byte compression to xxencode", () => {
    const entries = prepareArchiveEntries([{ id: "zeros", name: "zeros", path: "zeros", kind: "file", content: new Uint8Array(3) }]);
    const text = new TextDecoder().decode(writeStandardArchive(module, "tar.xx", entries, { variant: "gnu" }));
    const dataLines = text.split("\n").slice(1, -2);
    expect(dataLines.length).toBeGreaterThan(0);
    expect(dataLines.some((line) => line.length > 1)).toBe(true);
    expect(text).not.toContain("\nA\n");
  });
  it.each(["gnu", "pax", "ustar", "v7"] as const)("preserves tar variant %s", (variant) => {
    verify("tar", writeStandardArchive(module, "tar", prepared, { variant }));
  });
  it.each(["gnu", "pax"] as const)("supports long paths in %s", (variant) => {
    const entries = prepareArchiveEntries([{ id: "long", name: "long", path: `${"long-".repeat(35)}.txt`, kind: "file", content: new Uint8Array([3]) }]);
    verify("tar", writeStandardArchive(module, "tar", entries, { variant }), entries);
  });
  it("rejects output overflow and remains usable", () => {
    expect(() => writeStandardArchive(module, "tar", prepared, { variant: "gnu" }, 32)).toThrow(/limit/);
    verify("xar", writeStandardArchive(module, "xar", prepared, { variant: "gnu" }));
  });
  it("rejects unrepresentable v7 paths without truncated output", () => {
    const entries = prepareArchiveEntries([{ id: "long", name: "long", path: "a".repeat(150), kind: "file", content: new Uint8Array([1]) }]);
    expect(() => writeStandardArchive(module, "tar", entries, { variant: "v7" })).toThrow();
  });
});

describe("archive input validation", () => {
  it.each(["../escape", "/absolute", "C:/drive", "a\\b", "a//b", "a/./b", "a\0b"])("rejects unsafe %s", (path) => {
    expect(() => prepareArchiveEntries([{ ...input[2], path }])).toThrow(/Unsafe/);
  });
  it("rejects duplicates and file/directory conflicts", () => {
    expect(() => prepareArchiveEntries([input[2], input[2]])).toThrow(/Duplicate/);
    expect(() => prepareArchiveEntries([{ ...input[2], path: "root" }, input[1]])).toThrow(/directory/);
    expect(() => prepareArchiveEntries([input[1], { ...input[2], path: "root" }])).toThrow(/directory/);
  });
  it("rejects unloaded content instead of writing an empty file", () => {
    expect(() => prepareArchiveEntries([{ ...input[2], content: undefined }])).toThrow(/not loaded/);
  });
});
