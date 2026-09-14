import { describe, expect, it, vi } from "vitest";
import { encodeArchive } from "./archive";
import type { MkarCodec } from "./mkarCodec";

describe("archive backend routing", () => {
  const entries = [{ id: "file", path: "file", name: "file", kind: "file" as const, content: new Uint8Array([1]) }];
  it.each(["zip", "7z", "cpio", "xar", "tar", "tar.gz", "tar.bz2", "tar.xz", "tar.zst", "tar.lz4", "tar.lzma", "tar.lz", "tar.Z"] as const)("routes %s to libarchive", async (format) => {
    const encodeStandard = vi.fn(async () => new Uint8Array([7]));
    const codec: MkarCodec = { decode: async () => [], encode: vi.fn(), encodeStandard };
    expect(await encodeArchive(format, entries, codec, { tarVariant: "pax" })).toEqual(new Uint8Array([7]));
    expect(encodeStandard).toHaveBeenCalledWith(format, entries, { variant: "pax" });
    expect(codec.encode).not.toHaveBeenCalled();
  });
  it("combines libarchive TAR with retained Brotli", async () => {
    const tar = new Uint8Array([8]);
    const codec: MkarCodec = { decode: async () => [], encode: vi.fn(), encodeStandard: vi.fn(async () => tar), compressBrotli: vi.fn(async () => new Uint8Array([9])) };
    expect(await encodeArchive("tar.br", entries, codec)).toEqual(new Uint8Array([9]));
    expect(codec.encodeStandard).toHaveBeenCalledWith("tar", entries, { variant: "gnu" });
    expect(codec.compressBrotli).toHaveBeenCalledWith(tar);
  });
  it.each(["ar", "cab", "lzh", "mkar"] as const)("retains the %s backend", async (format) => {
    const encode = vi.fn(async () => new Uint8Array([1]));
    const codec: MkarCodec = { decode: async () => [], encode, encodeAr: encode, encodeCab: encode, encodeLzh: encode, encodeStandard: vi.fn() };
    await encodeArchive(format, entries, codec);
    expect(encode).toHaveBeenCalled();
    expect(codec.encodeStandard).not.toHaveBeenCalled();
  });
});
