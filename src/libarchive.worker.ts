import createModule from "./generated/libarchive/libarchive.mjs";
import wasmUrl from "./generated/libarchive/libarchive.wasm?url";
import { writeStandardArchive } from "./libarchiveRuntime";
import type { ArchiveRequest } from "./libarchive";

self.onmessage = async (event: MessageEvent<ArchiveRequest>) => {
  try {
    const module = await createModule({ locateFile: () => wasmUrl });
    const { format, entries, options } = event.data;
    const bytes = writeStandardArchive(module, format, entries, options);
    (self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage({ bytes }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
