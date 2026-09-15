import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { publishArtifacts, prepareArtifacts } from "./libarchive-artifacts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceLock = JSON.parse(readFileSync(join(root, "wasm/libarchive/sources.json"), "utf8"));
function run(command, args, cwd = root, capture = false) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  return result.stdout?.trim() ?? "";
}
const useDocker = process.env.LIBARCHIVE_NATIVE_BUILD !== "1";
const version = useDocker ? `Docker emscripten/emsdk:${sourceLock.emscripten}` : run("emcc", ["--version"], root, true);
if (!useDocker && !version.split("\n")[0].includes(` ${sourceLock.emscripten} `)) {
  throw new Error(`libarchive requires Emscripten ${sourceLock.emscripten}; found ${version.split("\n")[0]}`);
}
const hash = createHash("sha256").update(version).update(run("cmake", ["--version"], root, true));
for (const path of ["wasm/libarchive/sources.json", "wasm/libarchive/build.sh", "wasm/libarchive/build-dependencies.sh", "wasm/libarchive/build-libarchive.sh", "wasm/libarchive/writer.c", "wasm/libarchive/xxencode.c", "wasm/libarchive/shar.c", "wasm/libarchive/Dockerfile", "wasm/libarchive/rebuild-in-docker.sh"]) {
  hash.update(path).update(readFileSync(join(root, path)));
}
const key = hash.digest("hex");
const cache = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "mkar-online", "libarchive");
mkdirSync(cache, { recursive: true });
const completed = join(cache, key);
const names = ["libarchive.mjs", "libarchive.wasm", "NOTICE.txt"];
if (!existsSync(join(completed, "checksums.json"))) {
  const temporary = mkdtempSync(join(cache, "build-"));
  if (useDocker) {
    const image = `mkar-online-libarchive:${key.slice(0, 16)}`;
    run("docker", ["build", "--tag", image, "-f", join(root, "wasm/libarchive/Dockerfile"), root]);
    run("docker", ["run", "--rm", "-v", `${root}:/work`, "-v", `${temporary}:/work/.build`, image]);
    const checksums = Object.fromEntries(names.map((name) => [name, createHash("sha256").update(readFileSync(join(temporary, "artifacts", name))).digest("hex")]));
    writeFileSync(join(temporary, "checksums.json"), JSON.stringify(checksums, null, 2));
    writeFileSync(join(temporary, "toolchain.txt"), version);
    renameSync(temporary, completed);
  } else {
    const sources = join(temporary, "sources");
    mkdirSync(sources);
    for (const [name, source] of Object.entries(sourceLock.packages)) {
      const archive = join(sources, name === "bzip2" ? "bzip2-1.0.8.tar.gz" : `${name}.package`);
      run("curl", ["--fail", "--location", "--retry", "2", source.url, "--output", archive]);
      if (createHash("sha256").update(readFileSync(archive)).digest("hex") !== source.sha256) throw new Error(`${name} checksum mismatch`);
      if (name !== "bzip2") {
        run("tar", ["-xf", archive, "-C", sources]);
        const extracted = run("tar", ["-tf", archive], root, true).split("\n")[0].split("/")[0];
        run("mv", [join(sources, extracted), join(sources, name)]);
      }
    }
  run("bash", [join(root, "wasm/libarchive/build.sh"), sources, join(temporary, "build")]);
    const checksums = Object.fromEntries(names.map((name) => [name, createHash("sha256").update(readFileSync(join(temporary, "build/artifacts", name))).digest("hex")]));
    writeFileSync(join(temporary, "checksums.json"), JSON.stringify(checksums, null, 2));
    writeFileSync(join(temporary, "toolchain.txt"), version);
    renameSync(temporary, completed);
  }
}
const checksums = JSON.parse(readFileSync(join(completed, "checksums.json"), "utf8"));
for (const name of names) {
  const source = join(completed, useDocker ? "artifacts/" + name : "build/artifacts/" + name);
  if (createHash("sha256").update(readFileSync(source)).digest("hex") !== checksums[name]) throw new Error(`Cached ${name} failed SHA-256 verification`);
}
publishArtifacts(join(completed, useDocker ? "artifacts" : "build/artifacts"), { toolchain: version, buildCache: key });
prepareArtifacts();
