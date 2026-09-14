import type { MkarCodec, MkarEncodeOptions, TarVariant } from "./mkarCodec";
import type { ArchiveFormat, FsEntry } from "./types";

export type ArchiveEncodeOptions = MkarEncodeOptions & {
  tarVariant?: TarVariant;
};

export async function encodeArchive(
  format: ArchiveFormat,
  entries: FsEntry[],
  codec: MkarCodec | null,
  options: ArchiveEncodeOptions = {},
) {
  if (!codec) throw new Error(`${format} Wasm adapter is not loaded`);
  if (format === "mkar") return codec.encode(entries, options);
  if (format === "7z" && codec.encodeSevenZ) return codec.encodeSevenZ(entries);
  if (format === "ar" && codec.encodeAr) return codec.encodeAr(entries);
  if (format === "cab" && codec.encodeCab) return codec.encodeCab(entries);
  if (format === "cpio" && codec.encodeCpio) return codec.encodeCpio(entries);
  if (format === "lzh" && codec.encodeLzh) return codec.encodeLzh(entries);
  if (format === "zip" && codec.encodeZip) return codec.encodeZip(entries);
  const tarOptions = { variant: options.tarVariant ?? "gnu" };
  if (format === "tar" && codec.encodeTar)
    return codec.encodeTar(entries, tarOptions);
  if (format === "tar.gz" && codec.encodeTarGz)
    return codec.encodeTarGz(entries, tarOptions);
  if (codec.encodeTar && (format === "tar.xz" || format === "tar.zst")) {
    if (!codec.compress)
      throw new Error(`${format} compression is unavailable`);
    const tar = await codec.encodeTar(entries, tarOptions);
    return codec.compress(tar, format === "tar.xz" ? "xz" : "zstd");
  }
  if (codec.encodeTar) {
    const tar = await codec.encodeTar(entries, tarOptions);
    if (format === "tar.bz2" && codec.compressBzip2)
      return codec.compressBzip2(tar);
    if (format === "tar.lz4" && codec.compressLz4)
      return codec.compressLz4(tar);
    if (format === "tar.lzma" && codec.compressLzma)
      return codec.compressLzma(tar);
  if (format === "tar.lz" && codec.compressLz) return codec.compressLz(tar);
    if (format === "tar.br" && codec.compressBrotli)
      return codec.compressBrotli(tar);
  }
  throw new Error(`${format} Wasm encoder is unavailable`);
}
