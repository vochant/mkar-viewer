import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { artifactNames, digest, root, verifyArtifacts } from "./libarchive-artifacts.mjs";

verifyArtifacts();
const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" });
if (listed.status !== 0) throw new Error(listed.stderr);
const files = [...new Set(listed.stdout.split("\0").filter(Boolean))].filter((name) =>
  !/(^|\/)(node_modules|dist|target|\.git|\.vercel|\.idea|\.vscode)(\/|$)|(^|\/)\.env|\.(wasm|tgz|tar\.gz|tsbuildinfo)$/.test(name));
files.push(...[...artifactNames, "manifest.json"].map((name) => `wasm/libarchive/prebuilt/${name}`));
const directory = mkdtempSync(join(tmpdir(), "mkar-source-"));
const list = join(directory, "files.txt");
writeFileSync(list, files.sort().join("\0") + "\0");
const archive = join(directory, "mkar-online-source.tar.gz");
const result = spawnSync("tar", ["-czf", archive, "--null", "-T", list], { cwd: root, stdio: "inherit" });
if (result.status !== 0) throw new Error("Source packaging failed");
const checksum = `${digest(readFileSync(archive))}  mkar-online-source.tar.gz\n`;
writeFileSync(join(directory, "SHA256SUMS"), checksum);
console.log(`Source package: ${archive}\n${checksum}Temporary delivery artifact only; never use this archive as the source of truth for workspace recovery.`);
