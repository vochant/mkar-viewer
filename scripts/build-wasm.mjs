import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const crate = join(root, "wasm", "remkar-wasm");
const output = join(root, "src", "generated", "remkar-wasm");
const stamp = join(output, ".build-input-hash");

function filesIn(directory) {
  const files = [];
  for (const name of readdirSync(directory)) {
    if (name === "target") continue;
    const path = join(directory, name);
    const info = statSync(path);
    if (info.isDirectory()) files.push(...filesIn(path));
    else files.push(path);
  }
  return files;
}

const inputs = [
  ...filesIn(crate),
  join(root, "package.json"),
  join(root, "package-lock.json"),
  new URL(import.meta.url).pathname,
].filter((path) => existsSync(path)).sort();
const hash = createHash("sha256");
for (const path of inputs) {
  hash.update(relative(root, path));
  hash.update(readFileSync(path));
}
const inputHash = hash.digest("hex");
const wasmOutput = join(output, "remkar_wasm_bg.wasm");

if (existsSync(wasmOutput) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === inputHash) {
  console.log("wasm unchanged; skipping wasm-pack/wasm-opt");
  process.exit(0);
}

const result = spawnSync("npx", ["wasm-pack", "build", crate, "--target", "web", "--release", "--out-dir", output], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (result.status !== 0) process.exit(result.status ?? 1);
writeFileSync(stamp, `${inputHash}\n`);
