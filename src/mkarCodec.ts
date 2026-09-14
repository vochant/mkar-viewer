import initWasm, {
  buildManifest,
  compressXz,
  compressZstd,
  compressBzip2,
  compressLz4,
  compressLz,
  compressBrotli,
  compressLzma,
  decodeArchive,
  decodeStoredEntry,
  encodeAr,
  encodeArchive,
  encodeCab,
  encodeCpio,
  encodeLzh,
  encodeSevenZ,
  encodeTar,
  encodeTarGz,
  encodeZip,
  encodePlannedEntry,
  inspectEntryMetadata,
  inspectEntryProp,
  planArchive,
} from "./generated/remkar-wasm/remkar_wasm";
import type { FsEntry } from "./types";

export type MkarErrorCode =
  | "INVALID_ARCHIVE"
  | "UNSUPPORTED_VERSION"
  | "LIMIT_EXCEEDED"
  | "UNSUPPORTED_FEATURE"
  | "PASSWORD_REQUIRED"
  | "INCORRECT_PASSWORD"
  | "INVALID_ENTRY";

export type MkarLimits = {
  maxArchiveBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
  maxNameBytes: number;
};

export type MkarDecodeOptions = {
  limits?: Partial<MkarLimits>;
};

export type MkarEncodeOptions = {
  compress?: boolean;
  compressionAssignments?: Array<{ path: string; enabled: boolean }>;
  encryption?: {
    enabled: boolean;
    defaultKeyIndex?: number;
    keys: Array<{ index: number; password: string }>;
    assignments: Array<{ path: string; keyIndex: number | null }>;
    encryptDirectories: boolean;
  };
};

export type TarVariant = "gnu" | "pax" | "ustar" | "v7";
export type TarOptions = { variant: TarVariant };

export type ReadPasswordRequest = (
  keyIndex: number,
  incorrect: boolean,
) => Promise<string | null>;
/** @deprecated Use ReadPasswordRequest. Packing keys are write-side only. */
export type PasswordRequest = ReadPasswordRequest;

export type MkarProgress = {
  phase: "opening" | "exporting";
  completed: number;
  total: number;
};

export type MkarOutput = {
  write(chunk: Uint8Array): Promise<void>;
  seek?(position: number): Promise<void>;
};

export type ArchiveCompression = "xz" | "zstd";

export interface MkarCodec {
  decode(bytes: Uint8Array, options?: MkarDecodeOptions): Promise<FsEntry[]>;
  encode(entries: FsEntry[], options?: MkarEncodeOptions): Promise<Uint8Array>;
  read?(
    entry: FsEntry,
    requestPassword?: ReadPasswordRequest,
  ): Promise<Uint8Array>;
  reveal?(
    entry: FsEntry | undefined,
    includeEncryptedDescendants: boolean,
    requestPassword: ReadPasswordRequest,
  ): Promise<FsEntry[]>;
  close?(): void;
  compress?(bytes: Uint8Array, format: ArchiveCompression): Promise<Uint8Array>;
  compressBzip2?(bytes: Uint8Array): Promise<Uint8Array>;
  compressLz4?(bytes: Uint8Array): Promise<Uint8Array>;
  compressLz?(bytes: Uint8Array): Promise<Uint8Array>;
  compressBrotli?(bytes: Uint8Array): Promise<Uint8Array>;
  compressLzma?(bytes: Uint8Array): Promise<Uint8Array>;
  encodeAr?(entries: FsEntry[]): Promise<Uint8Array>;
  encodeCab?(entries: FsEntry[]): Promise<Uint8Array>;
  encodeSevenZ?(entries: FsEntry[]): Promise<Uint8Array>;
  encodeCpio?(entries: FsEntry[]): Promise<Uint8Array>;
  encodeLzh?(entries: FsEntry[]): Promise<Uint8Array>;
  encodeZip?(entries: FsEntry[]): Promise<Uint8Array>;
  encodeTar?(entries: FsEntry[], options: TarOptions): Promise<Uint8Array>;
  encodeTarGz?(entries: FsEntry[], options: TarOptions): Promise<Uint8Array>;
  open?(
    file: File,
    options?: MkarDecodeOptions,
    onProgress?: (progress: MkarProgress) => void,
  ): Promise<FsEntry[]>;
  encodeTo?(
    entries: FsEntry[],
    output: MkarOutput,
    options?: MkarEncodeOptions,
    onProgress?: (progress: MkarProgress) => void,
    requestPassword?: ReadPasswordRequest,
  ): Promise<void>;
}

export interface MkarWasmBindings {
  decodeArchive(bytes: Uint8Array, limits: Partial<MkarLimits>): unknown;
  encodeArchive(entries: unknown, options: MkarEncodeOptions): Uint8Array;
  inspectEntryMetadata?(
    bytes: Uint8Array,
    version: number,
    index: number,
  ): unknown;
  inspectEntryProp?(bytes: Uint8Array, index: number): unknown;
  decodeStoredEntry?(
    bytes: Uint8Array,
    version: number,
    limits: Partial<MkarLimits>,
    index: number,
    password?: string,
  ): unknown;
  buildManifest?(entries: unknown, limits: Partial<MkarLimits>): unknown;
  planArchive?(entries: unknown, options: MkarEncodeOptions): unknown;
  encodePlannedEntry?(
    entry: unknown,
    content: Uint8Array,
    options: MkarEncodeOptions,
  ): Uint8Array;
  compressXz?(bytes: Uint8Array): Uint8Array;
  compressZstd?(bytes: Uint8Array): Uint8Array;
  compressBzip2?(bytes: Uint8Array): Uint8Array;
  compressLz4?(bytes: Uint8Array): Uint8Array;
  compressLz?(bytes: Uint8Array): Uint8Array;
  compressBrotli?(bytes: Uint8Array): Uint8Array;
  compressLzma?(bytes: Uint8Array): Uint8Array;
  encodeAr?(entries: unknown): Uint8Array;
  encodeCab?(entries: unknown): Uint8Array;
  encodeSevenZ?(entries: unknown): Uint8Array;
  encodeCpio?(entries: unknown): Uint8Array;
  encodeLzh?(entries: unknown): Uint8Array;
  encodeZip?(entries: unknown): Uint8Array;
  encodeTar?(entries: unknown, options: TarOptions): Uint8Array;
  encodeTarGz?(entries: unknown, options: TarOptions): Uint8Array;
}

type WasmEntry = {
  path: string;
  kind: "file" | "folder";
  content?: Uint8Array | number[];
};

type ArchiveSlice = {
  name: string;
  start: number;
  end: number;
};

type EntryMetadata = { prop: number };
type StoredEntry = { prop: number; content: Uint8Array | number[] };
type ManifestItem = {
  path: string;
  kind: "file" | "folder";
  sourceIndex: number;
  encrypted: boolean;
  locked: boolean;
};
type PlannedItem = {
  path: string;
  name: string;
  kind: "file" | "folder";
  children: number[];
  root: boolean;
  keyIndex?: number;
};

type MetadataItem = {
  name: string;
  prop: number;
  sourceIndex: number;
  storedSize: number;
  locked: boolean;
  loaded: boolean;
  data: Uint8Array;
};

type OpenContext = {
  file: File;
  version: number;
  slices: ArchiveSlice[];
  metadata: MetadataItem[];
  passwords: Map<number, string>;
  operation: number;
};

const FILE_OVERHEAD = 225;
const PATH_PROP = 4;
const SYMLINK = 8;
const ROOTDIR = 16;
const ENCRYPTED = 64;
const MAX_ENTRIES = 10_000;
const MAX_NAME_BYTES = 1_024;
const MAX_METADATA_ENTRY_BYTES = 1024 * 1024;

export class MkarError extends Error {
  readonly code: MkarErrorCode;
  readonly entry?: number;
  readonly keyIndex?: number;

  constructor(
    message: string,
    code: MkarErrorCode = "INVALID_ARCHIVE",
    details: {
      entry?: number;
      keyIndex?: number;
    } = {},
  ) {
    super(message);
    this.name = "MkarError";
    this.code = code;
    this.entry = details.entry;
    this.keyIndex = details.keyIndex;
  }
}

let importSequence = 0;

export function createMkarCodec(
  bindings: MkarWasmBindings,
  now: () => number = Date.now,
): MkarCodec {
  let openContext: OpenContext | null = null;
  return {
    close() {
      openContext?.passwords.clear();
      openContext = null;
    },
    async decode(bytes, options) {
      try {
        const decoded = bindings.decodeArchive(bytes, options?.limits ?? {});
        if (!Array.isArray(decoded)) {
          throw new MkarError("Wasm decoder returned an invalid entry list");
        }
        const operation = ++importSequence;
        return decoded.map((raw, index) => toFsEntry(raw, operation, index));
      } catch (error) {
        throw normalizeError(error);
      }
    },

    async encode(entries, options) {
      try {
        return bindings.encodeArchive(
          entries.map((entry) => ({
            path: entry.path,
            kind: entry.kind,
            content:
              entry.kind === "file"
                ? (entry.content ?? new Uint8Array())
                : new Uint8Array(),
          })),
          options ?? {},
        );
      } catch (error) {
        throw normalizeError(error);
      }
    },

    async read(entry, requestPassword) {
      try {
        const passwords =
          entry.source?.kind === "mkar" &&
          openContext?.file === entry.source.file
            ? openContext.passwords
            : new Map<number, string>();
        return await readEntryContent(
          entry,
          bindings,
          passwords,
          requestPassword,
        );
      } catch (error) {
        throw normalizeError(error);
      }
    },

    async reveal(entry, includeEncryptedDescendants, requestPassword) {
      try {
        requireOpenBindings(bindings);
        if (!openContext) throw new MkarError("No MKAR archive is open");
        const roots =
          entry?.source?.kind === "mkar"
            ? [entry.source.sourceIndex]
            : openContext.metadata
                .filter((item) => item.prop & ROOTDIR)
                .map((item) => item.sourceIndex);
        for (const root of roots) {
          await revealMetadata(
            openContext,
            root,
            true,
            includeEncryptedDescendants,
            bindings,
            {},
            requestPassword,
            new Set(),
          );
        }
        return buildContextEntries(openContext, bindings, {});
      } catch (error) {
        throw normalizeError(error);
      }
    },

    async compress(bytes, format) {
      try {
        if (format === "xz") {
          if (!bindings.compressXz)
            throw new MkarError("tar.xz compression is unavailable");
          return bindings.compressXz(bytes);
        }
        if (!bindings.compressZstd)
          throw new MkarError("tar.zst compression is unavailable");
        return bindings.compressZstd(bytes);
      } catch (error) {
        throw normalizeError(error);
      }
    },

    async encodeAr(entries) {
      if (!bindings.encodeAr)
        throw new MkarError("ar packaging is unavailable");
      try {
        return bindings.encodeAr(toArchiveEntries(entries));
      } catch (error) {
        throw normalizeError(error);
      }
    },

    async encodeCab(entries) {
      if (!bindings.encodeCab)
        throw new MkarError("CAB packaging is unavailable");
      try {
        return bindings.encodeCab(toArchiveEntries(entries));
      } catch (error) {
        throw normalizeError(error);
      }
    },

    async encodeSevenZ(entries) {
      if (!bindings.encodeSevenZ)
        throw new MkarError("7z packaging is unavailable");
      try {
        return bindings.encodeSevenZ(toArchiveEntries(entries));
      } catch (error) {
        throw normalizeError(error);
      }
    },

    async compressBzip2(bytes) {
      if (!bindings.compressBzip2)
        throw new MkarError("tar.bz2 compression is unavailable");
      try {
        return bindings.compressBzip2(bytes);
      } catch (error) {
        throw normalizeError(error);
      }
    },

    async compressLz4(bytes) {
      if (!bindings.compressLz4)
        throw new MkarError("tar.lz4 compression is unavailable");
      try {
        return bindings.compressLz4(bytes);
      } catch (error) {
        throw normalizeError(error);
      }
    },

    async compressLz(bytes) {
      if (!bindings.compressLz)
        throw new MkarError("tar.lz compression is unavailable");
      try {
        return bindings.compressLz(bytes);
      } catch (error) {
        throw normalizeError(error);
      }
    },

    async compressBrotli(bytes) {
      if (!bindings.compressBrotli)
        throw new MkarError("tar.br compression is unavailable");
      try {
        return bindings.compressBrotli(bytes);
      } catch (error) {
        throw normalizeError(error);
      }
    },

    async compressLzma(bytes) {
      if (!bindings.compressLzma)
        throw new MkarError("tar.lzma compression is unavailable");
      try {
        return bindings.compressLzma(bytes);
      } catch (error) {
        throw normalizeError(error);
      }
    },


    async encodeCpio(entries) {
      if (!bindings.encodeCpio)
        throw new MkarError("cpio packaging is unavailable");
      try {
        return bindings.encodeCpio(toArchiveEntries(entries));
      } catch (error) {
        throw normalizeError(error);
      }
    },

    async encodeLzh(entries) {
      if (!bindings.encodeLzh)
        throw new MkarError("LZH packaging is unavailable");
      try {
        return bindings.encodeLzh(toArchiveEntries(entries));
      } catch (error) {
        throw normalizeError(error);
      }
    },

    async encodeZip(entries) {
      if (!bindings.encodeZip)
        throw new MkarError("ZIP packaging is unavailable");
      try {
        return bindings.encodeZip(toArchiveEntries(entries));
      } catch (error) {
        throw normalizeError(error);
      }
    },

    async encodeTar(entries, options) {
      if (!bindings.encodeTar)
        throw new MkarError("tar packaging is unavailable");
      try {
        return bindings.encodeTar(toArchiveEntries(entries), options);
      } catch (error) {
        throw normalizeError(error);
      }
    },

    async encodeTarGz(entries, options) {
      if (!bindings.encodeTarGz)
        throw new MkarError("tar.gz packaging is unavailable");
      try {
        return bindings.encodeTarGz(toArchiveEntries(entries), options);
      } catch (error) {
        throw normalizeError(error);
      }
    },

    async open(file, options, onProgress) {
      try {
        requireOpenBindings(bindings);
        const { version, slices } = await readArchiveIndex(file);
        const metadata: MetadataItem[] = [];
        for (let index = 0; index < slices.length; index += 1) {
          const slice = slices[index];
          if (slice.end - slice.start < FILE_OVERHEAD) {
            throw new MkarError("MKAR entry is shorter than its prefix");
          }
          const propBytes = await readSlice(file, slice.start, slice.start + 1);
          const inspectedProp = bindings.inspectEntryProp
            ? (bindings.inspectEntryProp(propBytes, index) as {
                prop: number;
              })
            : (bindings.inspectEntryMetadata(
                await readSlice(
                  file,
                  slice.start,
                  Math.min(slice.end, slice.start + FILE_OVERHEAD + 4),
                ),
                version,
                index,
              ) as EntryMetadata);
          if (!inspectedProp || typeof inspectedProp.prop !== "number") {
            throw new MkarError("Wasm inspector returned invalid property");
          }
          const inspected: EntryMetadata = inspectedProp;
          metadata.push({
            name: slice.name,
            prop: inspected.prop,
            sourceIndex: index,
            storedSize: slice.end - slice.start - FILE_OVERHEAD,
            locked: Boolean(inspected.prop & ENCRYPTED),
            loaded: false,
            data: new Uint8Array(),
          });
          onProgress?.({
            phase: "opening",
            completed: index + 1,
            total: slices.length,
          });
        }
        const context: OpenContext = {
          file,
          version,
          slices,
          metadata,
          passwords: new Map(),
          operation: ++importSequence,
        };
        openContext = context;
        return buildContextEntries(context, bindings, options?.limits ?? {});
      } catch (error) {
        throw normalizeError(error);
      }
    },

    async encodeTo(entries, output, options, onProgress, requestPassword) {
      try {
        requireWriteBindings(bindings);
        const planned = bindings.planArchive(
          entries.map((entry) => ({
            path: entry.path,
            kind: entry.kind,
            content: new Uint8Array(),
          })),
          options ?? {},
        );
        if (!Array.isArray(planned) || !planned.every(isPlannedItem)) {
          throw new MkarError("Wasm writer returned an invalid archive plan");
        }
        const seekable = typeof output.seek === "function";
        const sourceByPath = new Map(
          entries
            .filter((entry) => entry.kind === "file")
            .map((entry) => [entry.path, entry]),
        );
        const chunks: Uint8Array[] = [];
        const offsets: number[] = [];
        let position = 16;
        if (seekable) await output.write(makeHeader(0));
        for (let index = 0; index < planned.length; index += 1) {
          const item = planned[index];
          const source = sourceByPath.get(item.path);
          const content =
            item.kind === "file" && source
              ? await readEntryContent(
                  source,
                  bindings,
                  openContext?.passwords ?? new Map(),
                  requestPassword,
                )
              : new Uint8Array();
          const stored = bindings.encodePlannedEntry(
            item,
            content,
            options ?? {},
          );
          offsets.push(position);
          position += stored.byteLength;
          if (seekable) await output.write(stored);
          else chunks.push(stored);
          onProgress?.({
            phase: "exporting",
            completed: index + 1,
            total: planned.length,
          });
        }
        const fst = makeFst(planned, offsets);
        const header = makeHeader(position);
        if (seekable) {
          await output.write(fst);
          await output.seek!(0);
          await output.write(header);
          await output.seek!(position + fst.byteLength);
        } else {
          await output.write(header);
          for (const chunk of chunks) await output.write(chunk);
          await output.write(fst);
        }
      } catch (error) {
        throw normalizeError(error);
      }
    },
  };
}

type OpenBindings = MkarWasmBindings &
  Required<
    Pick<
      MkarWasmBindings,
      "inspectEntryMetadata" | "decodeStoredEntry" | "buildManifest"
    >
  >;

type WriteBindings = MkarWasmBindings &
  Required<Pick<MkarWasmBindings, "planArchive" | "encodePlannedEntry">>;

function requireOpenBindings(
  bindings: MkarWasmBindings,
): asserts bindings is OpenBindings {
  if (
    !bindings.inspectEntryMetadata ||
    !bindings.decodeStoredEntry ||
    !bindings.buildManifest
  ) {
    throw new MkarError("Progressive MKAR support is unavailable");
  }
}

function requireWriteBindings(
  bindings: MkarWasmBindings,
): asserts bindings is WriteBindings {
  if (!bindings.planArchive || !bindings.encodePlannedEntry) {
    throw new MkarError("Progressive MKAR support is unavailable");
  }
}

async function readEntryContent(
  entry: FsEntry,
  bindings: MkarWasmBindings,
  passwords: Map<number, string>,
  requestPassword?: ReadPasswordRequest,
) {
  if (entry.content) return entry.content;
  if (!entry.source) return new Uint8Array();
  if (entry.source.kind === "file") {
    return new Uint8Array(await entry.source.file.arrayBuffer());
  }
  if (!bindings.decodeStoredEntry) {
    throw new MkarError("Progressive MKAR decoding is unavailable");
  }
  const stored = await readSlice(
    entry.source.file,
    entry.source.start,
    entry.source.end,
  );
  return decodeStoredWithPassword(
    stored,
    entry.source.version,
    entry.source.sourceIndex,
    bindings,
    {},
    passwords,
    requestPassword,
  );
}

async function decodeStoredWithPassword(
  stored: Uint8Array,
  version: number,
  sourceIndex: number,
  bindings: MkarWasmBindings,
  limits: Partial<MkarLimits>,
  passwords: Map<number, string>,
  requestPassword?: ReadPasswordRequest,
) {
  if (!bindings.decodeStoredEntry) {
    throw new MkarError("Progressive MKAR decoding is unavailable");
  }
  let incorrect = false;
  let requestedKeyIndex: number | undefined;
  while (true) {
    const password =
      requestedKeyIndex === undefined
        ? undefined
        : passwords.get(requestedKeyIndex);
    try {
      const decoded = bindings.decodeStoredEntry(
        stored,
        version,
        limits,
        sourceIndex,
        password,
      ) as StoredEntry;
      return toBytes(decoded?.content);
    } catch (error) {
      const normalized = normalizeError(error);
      if (
        (normalized.code !== "PASSWORD_REQUIRED" &&
          normalized.code !== "INCORRECT_PASSWORD") ||
        normalized.keyIndex === undefined ||
        !requestPassword
      ) {
        throw normalized;
      }
      if (
        normalized.code === "PASSWORD_REQUIRED" &&
        passwords.has(normalized.keyIndex)
      ) {
        requestedKeyIndex = normalized.keyIndex;
        continue;
      }
      passwords.delete(normalized.keyIndex);
      incorrect = normalized.code === "INCORRECT_PASSWORD" || incorrect;
      const supplied = await requestPassword(normalized.keyIndex, incorrect);
      if (supplied === null) {
        throw new MkarError("Password entry cancelled", "PASSWORD_REQUIRED", {
          entry: sourceIndex,
          keyIndex: normalized.keyIndex,
        });
      }
      requestedKeyIndex = normalized.keyIndex;
      passwords.set(normalized.keyIndex, supplied);
    }
  }
}

async function revealMetadata(
  context: OpenContext,
  sourceIndex: number,
  unlockCurrent: boolean,
  unlockEncryptedDescendants: boolean,
  bindings: OpenBindings,
  limits: Partial<MkarLimits>,
  requestPassword: ReadPasswordRequest | undefined,
  stack: Set<number>,
): Promise<void> {
  if (stack.has(sourceIndex)) {
    throw new MkarError("MKAR archive graph contains a cycle");
  }
  const item = context.metadata[sourceIndex];
  const slice = context.slices[sourceIndex];
  if (!item || !slice) throw new MkarError("MKAR entry is out of range");
  if (!(item.prop & (PATH_PROP | SYMLINK))) return;
  if (item.locked && !unlockCurrent) return;
  stack.add(sourceIndex);
  try {
    if (!item.loaded) {
      if (slice.end - slice.start - FILE_OVERHEAD > MAX_METADATA_ENTRY_BYTES) {
        throw new MkarError(
          "MKAR directory metadata exceeds browser safety limits",
          "LIMIT_EXCEEDED",
          { entry: sourceIndex },
        );
      }
      item.data = await decodeStoredWithPassword(
        await readSlice(context.file, slice.start, slice.end),
        context.version,
        sourceIndex,
        bindings,
        {
          ...limits,
          maxEntryBytes: Math.min(
            limits.maxEntryBytes ?? 4 + MAX_ENTRIES * 4,
            4 + MAX_ENTRIES * 4,
          ),
        },
        context.passwords,
        requestPassword,
      );
      item.locked = false;
      item.loaded = true;
    }
    const children =
      item.prop & PATH_PROP
        ? directoryChildren(item.data, sourceIndex)
        : [readU32(item.data, 0, "symlink target")];
    if (!unlockEncryptedDescendants) {
      if (item.prop & PATH_PROP) {
        for (const child of children) {
          const childItem = context.metadata[child];
          if (!childItem)
            throw new MkarError("MKAR child entry is out of range");
          if (childItem.prop & SYMLINK) {
            await revealMetadata(
              context,
              child,
              !(childItem.prop & ENCRYPTED),
              false,
              bindings,
              limits,
              requestPassword,
              stack,
            );
          }
        }
      }
      return;
    }
    for (const child of children) {
      const childItem = context.metadata[child];
      if (!childItem) throw new MkarError("MKAR child entry is out of range");
      await revealMetadata(
        context,
        child,
        !(childItem.prop & ENCRYPTED) || unlockEncryptedDescendants,
        unlockEncryptedDescendants,
        bindings,
        limits,
        requestPassword,
        stack,
      );
    }
  } finally {
    stack.delete(sourceIndex);
  }
}

function directoryChildren(data: Uint8Array, sourceIndex: number) {
  if (data.byteLength < 4) {
    throw new MkarError(`Directory entry ${sourceIndex} is truncated`);
  }
  const count = readU32(data, 0, "directory child count");
  if (data.byteLength !== 4 + count * 4 || count > MAX_ENTRIES) {
    throw new MkarError(`Directory entry ${sourceIndex} has invalid children`);
  }
  return Array.from({ length: count }, (_, index) =>
    readU32(data, 4 + index * 4, "directory child"),
  );
}

function readU32(data: Uint8Array, offset: number, label: string) {
  if (offset + 4 > data.byteLength) throw new MkarError(`Truncated ${label}`);
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
    offset,
    true,
  );
}

function buildContextEntries(
  context: OpenContext,
  bindings: OpenBindings,
  limits: Partial<MkarLimits>,
) {
  const manifest = bindings.buildManifest(context.metadata, limits);
  if (!Array.isArray(manifest)) {
    throw new MkarError("Wasm inspector returned an invalid manifest");
  }
  return manifest.map((raw, index) => {
    if (!isManifestItem(raw)) {
      throw new MkarError("Wasm inspector returned an invalid entry");
    }
    const source = context.slices[raw.sourceIndex];
    const metadata = context.metadata[raw.sourceIndex];
    if (!source || !metadata) {
      throw new MkarError("Archive manifest references a missing entry");
    }
    return {
      id: `mkar-${context.operation}-${raw.sourceIndex}-${hashPath(raw.path)}`,
      name: raw.path.slice(raw.path.lastIndexOf("/") + 1),
      path: raw.path,
      kind: raw.kind,
      encrypted: raw.encrypted,
      locked: raw.locked,
      source: {
        kind: "mkar" as const,
        file: context.file,
        start: source.start,
        end: source.end,
        version: context.version,
        sourceIndex: raw.sourceIndex,
        prop: metadata.prop,
      },
    } satisfies FsEntry;
  });
}

async function readArchiveIndex(file: File) {
  const header = await readSlice(file, 0, 16);
  if (
    header.byteLength !== 16 ||
    new TextDecoder().decode(header.subarray(0, 4)) !== "MKAR"
  ) {
    throw new MkarError("Invalid MKAR signature");
  }
  const view = new DataView(
    header.buffer,
    header.byteOffset,
    header.byteLength,
  );
  if (view.getUint16(4, true) !== 0x2009) {
    throw new MkarError("Unsupported MKAR implementation");
  }
  const version = view.getUint16(6, true);
  if (version > 2) {
    throw new MkarError(
      `MKAR version ${version} is newer than supported version 2`,
      "UNSUPPORTED_VERSION",
    );
  }
  const fstBig = view.getBigUint64(8, true);
  if (fstBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MkarError("MKAR index offset exceeds browser integer range");
  }
  const fstOffset = Number(fstBig);
  const maxFstBytes = MAX_ENTRIES * (MAX_NAME_BYTES + 10) + 2;
  if (
    fstOffset < 16 ||
    fstOffset > file.size ||
    file.size - fstOffset > maxFstBytes
  ) {
    throw new MkarError(
      "MKAR index is outside supported bounds",
      "LIMIT_EXCEEDED",
    );
  }
  const fst = await readSlice(file, fstOffset, file.size);
  const fstView = new DataView(fst.buffer, fst.byteOffset, fst.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const slices: ArchiveSlice[] = [];
  let cursor = 0;
  let previous = 0;
  while (true) {
    if (cursor + 2 > fst.byteLength)
      throw new MkarError("Truncated MKAR index");
    const nameLength = fstView.getUint16(cursor, true);
    cursor += 2;
    if (nameLength === 0x8000) break;
    if (
      !nameLength ||
      nameLength > MAX_NAME_BYTES ||
      slices.length >= MAX_ENTRIES
    ) {
      throw new MkarError(
        "MKAR index exceeds browser safety limits",
        "LIMIT_EXCEEDED",
      );
    }
    if (cursor + nameLength + 8 > fst.byteLength)
      throw new MkarError("Truncated MKAR index entry");
    let name: string;
    try {
      name = decoder.decode(fst.subarray(cursor, cursor + nameLength));
    } catch {
      throw new MkarError("MKAR entry name is not valid UTF-8");
    }
    cursor += nameLength;
    const offsetBig = fstView.getBigUint64(cursor, true);
    cursor += 8;
    if (offsetBig > BigInt(Number.MAX_SAFE_INTEGER))
      throw new MkarError("MKAR entry offset exceeds browser integer range");
    const start = Number(offsetBig);
    if (
      start < 16 ||
      start >= fstOffset ||
      (slices.length ? start <= previous : start !== 16)
    ) {
      throw new MkarError("MKAR entry offsets are invalid");
    }
    if (slices.length) slices[slices.length - 1].end = start;
    slices.push({ name, start, end: fstOffset });
    previous = start;
  }
  if (cursor !== fst.byteLength)
    throw new MkarError("Unexpected bytes after MKAR index");
  if (slices.some((slice) => slice.end - slice.start < FILE_OVERHEAD)) {
    throw new MkarError("MKAR entry is shorter than its prefix");
  }
  return { version, slices };
}

async function readSlice(file: File, start: number, end: number) {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

function makeHeader(fstOffset: number) {
  const header = new Uint8Array(16);
  header.set(new TextEncoder().encode("MKAR"));
  const view = new DataView(header.buffer);
  view.setUint16(4, 0x2009, true);
  view.setUint16(6, 2, true);
  view.setBigUint64(8, BigInt(fstOffset), true);
  return header;
}

function makeFst(planned: PlannedItem[], offsets: number[]) {
  const encoder = new TextEncoder();
  const names = planned.map((entry) => encoder.encode(entry.name));
  const size = names.reduce(
    (total, name) => total + 2 + name.byteLength + 8,
    2,
  );
  const fst = new Uint8Array(size);
  const view = new DataView(fst.buffer);
  let cursor = 0;
  for (let index = 0; index < names.length; index += 1) {
    view.setUint16(cursor, names[index].byteLength, true);
    cursor += 2;
    fst.set(names[index], cursor);
    cursor += names[index].byteLength;
    view.setBigUint64(cursor, BigInt(offsets[index]), true);
    cursor += 8;
  }
  view.setUint16(cursor, 0x8000, true);
  return fst;
}

function toBytes(value: Uint8Array | number[] | undefined) {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(value);
  throw new MkarError("Wasm decoder returned invalid entry content");
}

function isManifestItem(value: unknown): value is ManifestItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ManifestItem>;
  return (
    typeof item.path === "string" &&
    (item.kind === "file" || item.kind === "folder") &&
    Number.isInteger(item.sourceIndex) &&
    typeof item.encrypted === "boolean" &&
    typeof item.locked === "boolean"
  );
}

function isPlannedItem(value: unknown): value is PlannedItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PlannedItem>;
  return (
    typeof item.path === "string" &&
    typeof item.name === "string" &&
    (item.kind === "file" || item.kind === "folder") &&
    Array.isArray(item.children) &&
    typeof item.root === "boolean"
  );
}

function toFsEntry(raw: unknown, operation: number, index: number): FsEntry {
  if (!isWasmEntry(raw)) {
    throw new MkarError("Wasm decoder returned an invalid archive entry");
  }
  const content =
    raw.kind === "file"
      ? raw.content instanceof Uint8Array
        ? raw.content
        : new Uint8Array(raw.content ?? [])
      : undefined;
  const name = raw.path.slice(raw.path.lastIndexOf("/") + 1);
  return {
    id: `mkar-${operation}-${index}-${hashPath(raw.path)}`,
    name,
    path: raw.path,
    kind: raw.kind,
    content,
  };
}

function isWasmEntry(value: unknown): value is WasmEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<WasmEntry>;
  return (
    typeof entry.path === "string" &&
    (entry.kind === "file" || entry.kind === "folder") &&
    (entry.content === undefined ||
      entry.content instanceof Uint8Array ||
      Array.isArray(entry.content))
  );
}

function hashPath(path: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function normalizeError(value: unknown): MkarError {
  if (value instanceof MkarError) return value;
  if (value instanceof Error) {
    const details = value as Error & {
      code?: unknown;
      entry?: unknown;
      keyIndex?: unknown;
    };
    return new MkarError(
      value.message,
      isErrorCode(details.code) ? details.code : "INVALID_ARCHIVE",
      {
        entry: typeof details.entry === "number" ? details.entry : undefined,
        keyIndex:
          typeof details.keyIndex === "number" ? details.keyIndex : undefined,
      },
    );
  }
  return new MkarError(
    typeof value === "string" ? value : "Unknown MKAR codec error",
  );
}

function isErrorCode(value: unknown): value is MkarErrorCode {
  return (
    typeof value === "string" &&
    [
      "INVALID_ARCHIVE",
      "UNSUPPORTED_VERSION",
      "LIMIT_EXCEEDED",
      "UNSUPPORTED_FEATURE",
      "PASSWORD_REQUIRED",
      "INCORRECT_PASSWORD",
      "INVALID_ENTRY",
    ].includes(value)
  );
}

let codecPromise: Promise<MkarCodec> | undefined;

export function loadMkarCodec(): Promise<MkarCodec> {
  if (!codecPromise) {
    codecPromise = initWasm().then(() =>
      createMkarCodec({
        decodeArchive,
        encodeArchive,
        inspectEntryMetadata,
        inspectEntryProp,
        decodeStoredEntry,
        buildManifest,
        planArchive,
        encodePlannedEntry,
        compressXz,
        compressZstd,
        compressBzip2,
        compressLz4,
        compressLz,
        compressBrotli,
        compressLzma,
        encodeAr,
        encodeCab,
        encodeSevenZ,
        encodeCpio,
        encodeLzh,
        encodeZip,
        encodeTar,
        encodeTarGz,
      }),
    );
  }
  return codecPromise;
}

function toArchiveEntries(entries: FsEntry[]) {
  return entries.map((entry) => ({
    path: entry.path,
    kind: entry.kind,
    content:
      entry.kind === "file"
        ? (entry.content ?? new Uint8Array())
        : new Uint8Array(),
  }));
}
