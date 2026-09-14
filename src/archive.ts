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
  onProgress?: (completed: number, total: number) => void,
) {
  if (!codec) throw new Error(`${format} Wasm adapter is not loaded`);
  if (format === "mkar") return codec.encode(entries, options);
  if (format === "ar" && codec.encodeAr) return onProgress ? codec.encodeAr(entries, onProgress) : codec.encodeAr(entries);
  if (format === "cab" && codec.encodeCab) return onProgress ? codec.encodeCab(entries, onProgress) : codec.encodeCab(entries);
  if (format === "lzh" && codec.encodeLzh) return onProgress ? codec.encodeLzh(entries, onProgress) : codec.encodeLzh(entries);
  if (format === "ar" || format === "cab" || format === "lzh" || !codec.encodeStandard) {
    throw new Error(`${format} Wasm encoder is unavailable`);
  }
  const tarOptions = { variant: options.tarVariant ?? "gnu" };
  if (format === "tar.br") {
    if (!codec.compressBrotli) throw new Error("Brotli compression is unavailable");
    return codec.compressBrotli(onProgress ? await codec.encodeStandard("tar", entries, tarOptions, onProgress) : await codec.encodeStandard("tar", entries, tarOptions));
  }
  return onProgress ? codec.encodeStandard(format, entries, tarOptions, onProgress) : codec.encodeStandard(format, entries, tarOptions);
}
