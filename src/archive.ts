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
  if (format === "ar" && codec.encodeAr) return codec.encodeAr(entries);
  if (format === "cab" && codec.encodeCab) return codec.encodeCab(entries);
  if (format === "lzh" && codec.encodeLzh) return codec.encodeLzh(entries);
  if (format === "ar" || format === "cab" || format === "lzh" || !codec.encodeStandard) {
    throw new Error(`${format} Wasm encoder is unavailable`);
  }
  const tarOptions = { variant: options.tarVariant ?? "gnu" };
  if (format === "tar.br") {
    if (!codec.compressBrotli) throw new Error("Brotli compression is unavailable");
    return codec.compressBrotli(await codec.encodeStandard("tar", entries, tarOptions));
  }
  return codec.encodeStandard(format, entries, tarOptions);
}
