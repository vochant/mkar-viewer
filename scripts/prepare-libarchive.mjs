import { prepareArtifacts } from "./libarchive-artifacts.mjs";

try {
  prepareArtifacts();
} catch (error) {
  console.error(`Cannot prepare libarchive: ${error.message}`);
  console.error("Use a source package containing wasm/libarchive/prebuilt, or explicitly run npm run libarchive:rebuild. No automatic compilation is attempted.");
  process.exitCode = 1;
}
