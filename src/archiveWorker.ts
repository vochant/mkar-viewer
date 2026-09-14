import type { ArchiveInput, StandardArchiveFormat } from "./libarchive";
import type { MkarEncodeOptions, TarOptions } from "./mkarCodec";
import type { ArchiveFormat } from "./types";
import type { ReadPasswordRequest } from "./mkarCodec";

type WorkerFormat = StandardArchiveFormat | "mkar" | "ar" | "cab" | "lzh" | "tar.br";
export type WorkerRequest = {
  id: number;
  op: "archive" | "mkar";
  format?: ArchiveFormat;
  method?: string;
  entries?: ArchiveInput[];
  input?: Uint8Array;
  options?: TarOptions & MkarEncodeOptions;
  payload?: unknown;
  passwordResponse?: { value: string | null };
};
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  progress?: (completed: number, total: number) => void;
  requestPassword?: ReadPasswordRequest;
};

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./archive.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<{ id: number; value?: unknown; error?: { message: string; code?: string; entry?: number; keyIndex?: number } | string; progress?: { completed: number; total: number }; password?: { keyIndex: number; incorrect: boolean } }>) => {
    const request = pending.get(event.data.id);
    if (!request) return;
    if (event.data.progress) {
      request.progress?.(event.data.progress.completed, event.data.progress.total);
      return;
    }
    if (event.data.password) {
      const { keyIndex, incorrect } = event.data.password;
      void request.requestPassword?.(keyIndex, incorrect).then(
        (value) => worker?.postMessage({ id: event.data.id, passwordResponse: { value } }),
        () => worker?.postMessage({ id: event.data.id, passwordResponse: { value: null } }),
      );
      return;
    }
    pending.delete(event.data.id);
    if (event.data.error) {
      const error = typeof event.data.error === "string" ? event.data.error : event.data.error.message;
      request.reject(Object.assign(new Error(error), typeof event.data.error === "string" ? {} : event.data.error));
    }
    else request.resolve(event.data.value);
  };
  const fail = (error: Error) => {
    worker = undefined;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  worker.onerror = (event) => fail(new Error(event.message || "Archive worker failed"));
  worker.onmessageerror = () => fail(new Error("Invalid archive worker response"));
  return worker;
}

export function canUseArchiveWorker() {
  return typeof Worker !== "undefined";
}

export function encodeInArchiveWorker(
  format: ArchiveFormat,
  entries: ArchiveInput[],
  options: TarOptions & MkarEncodeOptions,
  progress?: (completed: number, total: number) => void,
) {
  return callWorker({ op: "archive", format: format as WorkerFormat, entries, options }, progress) as Promise<Uint8Array>;
}

export function callMkarWorker(method: string, payload: unknown) {
  return callWorker({ op: "mkar", method, payload });
}

export function callMkarWorkerWithProgress(
  method: string,
  payload: unknown,
  progress?: (completed: number, total: number) => void,
  requestPassword?: ReadPasswordRequest,
) {
  return callWorker({ op: "mkar", method, payload }, progress, requestPassword);
}

function callWorker(request: Omit<WorkerRequest, "id">, progress?: (completed: number, total: number) => void, requestPassword?: ReadPasswordRequest) {
  return new Promise<unknown>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, progress, requestPassword });
    try { getWorker().postMessage({ ...request, id }); }
    catch (error) { pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
  });
}
