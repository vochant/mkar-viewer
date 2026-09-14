import type { ArchiveFormat, FsEntry } from "./types";
import type { TarOptions } from "./mkarCodec";

export type StandardArchiveFormat = Exclude<ArchiveFormat, "mkar" | "ar" | "cab" | "lzh" | "tar.br">;
export type ArchiveInput = { path: string; kind: "file" | "folder"; content: Uint8Array };
export type ArchiveRequest = { format: StandardArchiveFormat; entries: ArchiveInput[]; options: TarOptions };

export function prepareArchiveEntries(entries: FsEntry[]): ArchiveInput[] {
  const canonical = new Map<string, ArchiveInput>();
  const explicit = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    const path = entry.path;
    const parts = path.split("/");
    if (!path || path.includes("\\") || path.includes("\0") || /^[A-Za-z]:/.test(path) || parts.some((part) => !part || part === "." || part === "..") || parts.length > 64 || new TextEncoder().encode(path).length > 4096) {
      throw new Error(`Unsafe archive path: ${path}`);
    }
    if (explicit.has(path)) throw new Error(`Duplicate archive path: ${path}`);
    explicit.add(path);
    if (entry.kind === "file" && !entry.content) throw new Error(`Archive content was not loaded: ${path}`);
    const content = entry.kind === "file" ? entry.content! : new Uint8Array();
    total += content.length;
    if (content.length > 128 * 1024 * 1024 || total > 256 * 1024 * 1024) throw new Error("Archive input exceeds browser memory limits");
    for (let depth = 1; depth < parts.length; depth++) {
      const parent = parts.slice(0, depth).join("/");
      if (canonical.get(parent)?.kind === "file") throw new Error(`File used as a directory: ${parent}`);
      if (!canonical.has(parent)) canonical.set(parent, { path: parent, kind: "folder", content: new Uint8Array() });
    }
    if (canonical.has(path) && entry.kind !== "folder") throw new Error(`File used as a directory: ${path}`);
    canonical.set(path, { path, kind: entry.kind, content });
    if (canonical.size > 10_000) throw new Error("Archive contains too many entries");
  }
  return [...canonical.values()].sort((first, second) => first.path < second.path ? -1 : first.path > second.path ? 1 : 0);
}

export function encodeStandardArchive(format: StandardArchiveFormat, entries: FsEntry[], options: TarOptions): Promise<Uint8Array> {
  const prepared = prepareArchiveEntries(entries);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./libarchive.worker.ts", import.meta.url), { type: "module" });
    const timer = setTimeout(() => fail(new Error("Archive export timed out")), 5 * 60 * 1000);
    function finish() { clearTimeout(timer); worker.terminate(); }
    function fail(error: Error) { finish(); reject(error); }
    worker.onerror = (event) => fail(new Error(event.message || "libarchive worker failed"));
    worker.onmessageerror = () => fail(new Error("Invalid libarchive worker response"));
    worker.onmessage = (event: MessageEvent<{ bytes?: Uint8Array; error?: string }>) => {
      finish();
      if (event.data.bytes instanceof Uint8Array) resolve(event.data.bytes);
      else reject(new Error(event.data.error ?? "libarchive returned no output"));
    };
    try { worker.postMessage({ format, entries: prepared, options } satisfies ArchiveRequest); }
    catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  });
}
