import type { ArchiveInput, StandardArchiveFormat } from "./libarchive";
import type { TarOptions } from "./mkarCodec";

export interface LibarchiveModule {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _la_finish(writer: number): number;
  _la_data(writer: number): number;
  _la_size(writer: number): number;
  _la_free(writer: number): void;
  cwrap(name: string, result: string | null, args: string[]): (...args: any[]) => any;
}

export function archiveConfiguration(format: StandardArchiveFormat, options: TarOptions) {
  const variants = { gnu: "gnutar", pax: "pax", ustar: "ustar", v7: "v7tar" };
  const filters: Record<string, string> = { "tar": "none", "tar.gz": "gzip", "tar.bz2": "bzip2", "tar.xz": "xz", "tar.zst": "zstd", "tar.lz4": "lz4", "tar.lzma": "lzma", "tar.lz": "lzip", "tar.Z": "compress" };
  if (format in filters) {
    const variant = variants[options.variant];
    if (!variant) throw new Error(`Unsupported tar variant: ${options.variant}`);
    return { format: variant, filter: filters[format] };
  }
  const formats = { zip: "zip", "7z": "7zip", cpio: "newc", xar: "xar" };
  const archiveFormat = formats[format as keyof typeof formats];
  if (!archiveFormat) throw new Error(`Unsupported archive format: ${format}`);
  return { format: archiveFormat, filter: "none" };
}

export function writeStandardArchive(module: LibarchiveModule, format: StandardArchiveFormat, entries: ArchiveInput[], options: TarOptions, maxOutputBytes = 512 * 1024 * 1024) {
  const configuration = archiveConfiguration(format, options);
  const files = entries;
  const create = module.cwrap("la_create", "number", ["string", "string", "number"]);
  const add = module.cwrap("la_add", "number", ["number", "string", "number", "number", "number"]);
  const getError = module.cwrap("la_error", "string", ["number"]);
  const writer = create(configuration.format, configuration.filter, maxOutputBytes);
  if (!writer) throw new Error("Could not initialize libarchive writer");
  function check(status: number) {
    if (status !== 0) throw new Error(getError(writer) || `libarchive failed (${status})`);
  }
  try {
    const error = getError(writer);
    if (error) throw new Error(error);
    for (const entry of files) {
      const pointer = module._malloc(Math.max(1, entry.content.length));
      if (!pointer) throw new Error("Could not allocate libarchive input");
      try {
        module.HEAPU8.set(entry.content, pointer);
        check(add(writer, entry.kind === "folder" ? `${entry.path}/` : entry.path, Number(entry.kind === "folder"), pointer, entry.content.length));
      } finally { module._free(pointer); }
    }
    check(module._la_finish(writer));
    const length = module._la_size(writer);
    if (length > maxOutputBytes) throw new Error("Archive output exceeds configured limit");
    return module.HEAPU8.slice(module._la_data(writer), module._la_data(writer) + length);
  } finally { module._la_free(writer); }
}
