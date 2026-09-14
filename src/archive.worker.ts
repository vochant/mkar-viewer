import initMkar, {
  buildManifest,
  compressBrotli,
  decodeArchive,
  decodeStoredEntry,
  encodeArchive,
  encodeAr,
  encodeCab,
  encodeLzh,
  encodePlannedEntry,
  inspectEntryMetadata,
  inspectEntryProp,
  planArchive,
} from "./generated/remkar-wasm/remkar_wasm";
import remkarWasmUrl from "./generated/remkar-wasm/remkar_wasm_bg.wasm?url";
import createLibarchiveModule from "./generated/libarchive/libarchive.mjs";
import libarchiveWasmUrl from "./generated/libarchive/libarchive.wasm?url";
import { createMkarCodec } from "./mkarCodec";
import { writeStandardArchive, type LibarchiveModule } from "./libarchiveRuntime";
import type { ArchiveInput, StandardArchiveFormat } from "./libarchive";
import type { MkarEncodeOptions, TarOptions } from "./mkarCodec";
import type { FsEntry } from "./types";

type WorkerRequest = {
  id: number;
  op: "archive" | "mkar";
  format: StandardArchiveFormat | "mkar" | "ar" | "cab" | "lzh" | "tar.br";
  entries: ArchiveInput[];
  options: TarOptions & MkarEncodeOptions;
  method?: string;
  input?: Uint8Array;
  payload?: unknown;
  passwordResponse?: { value: string | null };
};

let mkarPromise: ReturnType<typeof loadMkar> | undefined;
let libarchivePromise: ReturnType<typeof loadLibarchive> | undefined;

async function loadMkar() {
  await initMkar(remkarWasmUrl);
  return createMkarCodec({
    decodeArchive,
    encodeArchive,
    inspectEntryMetadata,
    inspectEntryProp,
    decodeStoredEntry,
    buildManifest,
    planArchive,
    encodePlannedEntry,
    compressBrotli,
    encodeAr,
    encodeCab,
    encodeLzh,
  });
}

async function loadLibarchive() {
  const response = await fetch(libarchiveWasmUrl);
  if (!response.ok) throw new Error(`Could not load libarchive WASM (${response.status})`);
  return createLibarchiveModule({ wasmBinary: new Uint8Array(await response.arrayBuffer()) });
}

function asFsEntries(entries: ArchiveInput[]): FsEntry[] {
  return entries.map((entry, index) => ({
    id: `worker-${index}`,
    name: entry.path.slice(entry.path.lastIndexOf("/") + 1),
    path: entry.path,
    kind: entry.kind,
    content: entry.content,
  }));
}

function getMkar() {
  return (mkarPromise ??= loadMkar());
}

function getLibarchive() {
  return (libarchivePromise ??= loadLibarchive());
}

const passwordWaiters = new Map<number, (value: string | null) => void>();

function requestPassword(id: number, keyIndex: number, incorrect: boolean) {
  return new Promise<string | null>((resolve) => {
    passwordWaiters.set(id, resolve);
    self.postMessage({ id, password: { keyIndex, incorrect } });
  });
}

function restoreEntry(value: unknown): FsEntry {
  return value as FsEntry;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, op, format, entries, options, method, input, payload, passwordResponse } = event.data;
  if (passwordResponse) {
    passwordWaiters.get(id)?.(passwordResponse.value);
    passwordWaiters.delete(id);
    return;
  }
  try {
    if (op === "mkar") {
      const codec = await getMkar();
      const password = (keyIndex: number, incorrect: boolean) => requestPassword(id, keyIndex, incorrect);
      let value: unknown;
      switch (method) {
        case "decode": {
          const request = payload as { bytes: Uint8Array; options?: unknown };
          value = await codec.decode(request.bytes, request.options as never);
          break;
        }
        case "encode": {
          const request = payload as { entries: FsEntry[]; options?: unknown };
          value = await codec.encode(request.entries.map(restoreEntry), request.options as never);
          break;
        }
        case "compressBrotli":
          value = await codec.compressBrotli!(payload as Uint8Array);
          break;
        case "encodeAr":
        case "encodeCab":
        case "encodeLzh": {
          const request = payload as { entries: FsEntry[]; };
          const encoder = method === "encodeAr" ? codec.encodeAr : method === "encodeCab" ? codec.encodeCab : codec.encodeLzh;
          if (!encoder) throw new Error(`${method} is unavailable`);
          value = await encoder(request.entries.map(restoreEntry));
          break;
        }
        case "open": {
          const request = payload as { file: File; options?: unknown };
          value = await codec.open!(request.file, request.options as never, (progress) => self.postMessage({ id, progress: { completed: progress.completed, total: progress.total } }));
          break;
        }
        case "read": {
          const request = payload as { entry: FsEntry };
          value = await codec.read!(restoreEntry(request.entry), password);
          break;
        }
        case "reveal": {
          const request = payload as { entry?: FsEntry; includeEncryptedDescendants: boolean };
          value = await codec.reveal!(request.entry && restoreEntry(request.entry), request.includeEncryptedDescendants, password);
          break;
        }
        case "close":
          codec.close?.();
          value = undefined;
          break;
        case "encodeTo": {
          const request = payload as { entries: FsEntry[]; options?: unknown };
          const chunks: Uint8Array[] = [];
          await codec.encodeTo!(request.entries.map(restoreEntry), { write: async (chunk) => { chunks.push(chunk); } }, request.options as never, (progress) => self.postMessage({ id, progress: { completed: progress.completed, total: progress.total } }), password);
          const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          value = bytes;
          break;
        }
        default:
          throw new Error(`Unknown remkar worker method: ${method}`);
      }
      if (value instanceof Uint8Array) {
        (self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage({ id, value }, [value.buffer]);
      } else self.postMessage({ id, value });
      return;
    }
    let bytes: Uint8Array;
    if (format === "mkar") {
      bytes = await (await getMkar()).encode(asFsEntries(entries), options);
    } else if (format === "ar") {
      bytes = await (await getMkar()).encodeAr!(asFsEntries(entries));
    } else if (format === "cab") {
      bytes = await (await getMkar()).encodeCab!(asFsEntries(entries));
    } else if (format === "lzh") {
      bytes = await (await getMkar()).encodeLzh!(asFsEntries(entries));
    } else if (format === "tar.br") {
      const tar = writeStandardArchive(await getLibarchive() as LibarchiveModule, "tar", entries, options, undefined, (completed, total) => self.postMessage({ id, progress: { completed, total } }));
      bytes = await (await getMkar()).compressBrotli!(tar);
    } else {
      bytes = writeStandardArchive(await getLibarchive() as LibarchiveModule, format, entries, options, undefined, (completed, total) => self.postMessage({ id, progress: { completed, total } }));
    }
    (self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage({ id, value: bytes }, [bytes.buffer]);
  } catch (error) {
    const value = error as Error & { code?: string; entry?: number; keyIndex?: number };
    self.postMessage({ id, error: error instanceof Error ? { message: value.message, code: value.code, entry: value.entry, keyIndex: value.keyIndex } : { message: String(error) } });
  }
};
