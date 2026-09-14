import { writeStandardArchive } from "./libarchiveRuntime";
import createModule from "./generated/libarchive/libarchive.mjs";
import wasmUrl from "./generated/libarchive/libarchive.wasm?url";
import type { ArchiveRequest } from "./libarchive";

let modulePromise: ReturnType<typeof loadModule> | undefined;

async function loadModule() {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Could not load libarchive WASM (${response.status})`);
  const wasmBinary = new Uint8Array(await response.arrayBuffer());
  return createModule({ wasmBinary });
}

self.onmessage = async (event: MessageEvent<ArchiveRequest>) => {
  try {
    modulePromise ??= loadModule();
    const module = await modulePromise;
    const { format, entries, options } = event.data;
    const bytes = writeStandardArchive(module, format, entries, options, undefined, (completed, total) => self.postMessage({ progress: { completed, total } }));
    (self as unknown as { postMessage(message: unknown, transfer: Transferable[]): void }).postMessage({ bytes }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
