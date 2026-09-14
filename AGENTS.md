# Repository Safety Rules

These rules apply to every future change in this repository.

1. Never delete, overwrite, reset, checkout, orphan-branch, or rewrite repository data before making a verified, independent backup of the complete workspace and relevant Git metadata.
2. Never use `src.tar.gz` or any generated archive as a source of truth for current source code. It is a temporary artifact, not a recovery mechanism.
3. Before destructive cleanup, print and verify the exact target paths. Prefer a reversible copy or move. Keep the recovery copy outside the repository and record SHA-256 checksums.
4. Never commit `node_modules`, `dist`, `.vercel`, `.env*`, generated WASM, Rust `target`, temporary archives, or editor/session artifacts.
5. Do not rewrite `mainline` or introduce breaking changes there without explicit user approval. Experiments belong on a separate branch.
6. Before claiming completion, run the relevant tests, TypeScript checks, and build; report failures plainly.
7. Preserve user changes. Do not use destructive Git commands to hide or discard them.

If a requested operation conflicts with these rules, stop and make a safe backup first.
