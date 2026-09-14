declare module "*/libarchive.mjs" {
  const createModule: (options: { locateFile?: (path: string) => string; wasmBinary?: Uint8Array }) => Promise<import("./libarchiveRuntime").LibarchiveModule>;
  export default createModule;
}

declare module "*.wasm?url" {
  const url: string;
  export default url;
}
