import { describe, expect, it, vi } from "vitest";
import { createMkarCodec, MkarError, type MkarWasmBindings } from "./mkarCodec";

function fakeBindings(decoded: unknown): MkarWasmBindings {
  return {
    decodeArchive: () => decoded,
    encodeArchive: () => new Uint8Array([77, 75, 65, 82]),
  };
}

function u64(value: number) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}

describe("createMkarCodec", () => {
  it("assigns path-derived unique ids", async () => {
    const codec = createMkarCodec(
      fakeBindings([
        { path: "root", kind: "folder", content: new Uint8Array() },
        { path: "root/a.txt", kind: "file", content: new Uint8Array([65]) },
      ]),
      () => 1234,
    );

    const entries = await codec.decode(new Uint8Array([1]));

    expect(entries.map(({ path, kind }) => ({ path, kind }))).toEqual([
      { path: "root", kind: "folder" },
      { path: "root/a.txt", kind: "file" },
    ]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
  });

  it("preserves structured Wasm errors", async () => {
    const source = Object.assign(
      new Error("Archive entry 3 requires password key 7"),
      {
        code: "PASSWORD_REQUIRED",
        entry: 3,
        keyIndex: 7,
      },
    );
    const codec = createMkarCodec({
      decodeArchive: () => {
        throw source;
      },
      encodeArchive: () => new Uint8Array(),
    });

    await expect(codec.decode(new Uint8Array())).rejects.toEqual(
      expect.objectContaining({
        name: "MkarError",
        code: "PASSWORD_REQUIRED",
        entry: 3,
        keyIndex: 7,
      } satisfies Partial<MkarError>),
    );
  });

  it("passes browser entries to the Wasm writer without UI-only fields", async () => {
    let received: unknown;
    const codec = createMkarCodec({
      decodeArchive: () => [],
      encodeArchive: (entries) => {
        received = entries;
        return new Uint8Array([1, 2, 3]);
      },
    });

    const bytes = await codec.encode([
      {
        id: "ui-id",
        name: "a.txt",
        path: "root/a.txt",
        kind: "file",
        content: new Uint8Array([65]),
      },
    ]);

    expect(received).toEqual([
      {
        path: "root/a.txt",
        kind: "file",
        content: new Uint8Array([65]),
      },
    ]);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("opens an archive by slicing metadata and leaves file payloads lazy", async () => {
    const bytes = new Uint8Array(16 + 227 + 2 + 1 + 8 + 2);
    bytes.set(new TextEncoder().encode("MKAR"), 0);
    bytes.set(new Uint8Array([9, 32, 2, 0]), 4);
    bytes.set(u64(243), 8);
    bytes.set(new Uint8Array([1, 0, 97]), 243);
    bytes.set(u64(16), 246);
    bytes.set(new Uint8Array([0, 128]), 254);
    const file = new File([bytes], "large.mkar");
    const slice = vi.spyOn(file, "slice");
    const codec = createMkarCodec(
      {
        ...fakeBindings([]),
        inspectEntryMetadata: () => ({ prop: 16 }),
        buildManifest: () => [
          {
            path: "a",
            kind: "file",
            sourceIndex: 0,
            size: 2,
            encrypted: false,
            locked: false,
          },
        ],
        decodeStoredEntry: () => ({ prop: 16, content: new Uint8Array() }),
      },
      () => 1234,
    );

    const entries = await codec.open!(file);

    expect(entries[0]).toEqual(
      expect.objectContaining({
        path: "a",
        source: expect.objectContaining({
          kind: "mkar",
          file,
          start: 16,
          end: 243,
          version: 2,
          sourceIndex: 0,
        }),
      }),
    );
    expect(entries[0].content).toBeUndefined();
    expect(slice).not.toHaveBeenCalledWith(0, file.size);
  });

  it("parses only the directory whose children are being viewed", async () => {
    const offsets = [16, 249, 482];
    const names = ["root", "nested", "deep.txt"];
    const fstOffset = 708;
    const fstSize = names.reduce(
      (total, name) => total + 2 + name.length + 8,
      2,
    );
    const bytes = new Uint8Array(fstOffset + fstSize);
    bytes.set(new TextEncoder().encode("MKAR"), 0);
    bytes.set(new Uint8Array([9, 32, 2, 0]), 4);
    bytes.set(u64(fstOffset), 8);
    let cursor = fstOffset;
    for (const [index, name] of names.entries()) {
      new DataView(bytes.buffer).setUint16(cursor, name.length, true);
      cursor += 2;
      bytes.set(new TextEncoder().encode(name), cursor);
      cursor += name.length;
      bytes.set(u64(offsets[index]), cursor);
      cursor += 8;
    }
    new DataView(bytes.buffer).setUint16(cursor, 0x8000, true);

    const decodeStoredEntry = vi.fn(
      (_stored, _version, _limits, index: number) => ({
        prop: index === 0 ? 20 : 4,
        content: new Uint8Array([1, 0, 0, 0, index + 1, 0, 0, 0]),
      }),
    );
    const buildManifest = vi.fn((metadata: unknown) => {
      const items = metadata as Array<{ loaded: boolean }>;
      return [
        {
          path: "root",
          kind: "folder",
          sourceIndex: 0,
          size: 0,
          encrypted: false,
          locked: false,
        },
        ...(items[0].loaded
          ? [
              {
                path: "root/nested",
                kind: "folder" as const,
                sourceIndex: 1,
                size: 0,
                encrypted: false,
                locked: false,
              },
            ]
          : []),
        ...(items[1].loaded
          ? [
              {
                path: "root/nested/deep.txt",
                kind: "file" as const,
                sourceIndex: 2,
                size: 1,
                encrypted: false,
                locked: false,
              },
            ]
          : []),
      ];
    });
    const codec = createMkarCodec({
      ...fakeBindings([]),
      inspectEntryMetadata: (_input, _version, index) => ({
        prop: index === 0 ? 20 : index === 1 ? 4 : 0,
      }),
      decodeStoredEntry,
      buildManifest,
    });

    const opened = await codec.open!(new File([bytes], "nested.mkar"));
    expect(opened.map((entry) => entry.path)).toEqual(["root"]);
    expect(decodeStoredEntry).not.toHaveBeenCalled();

    const rootRevealed = await codec.reveal!(
      opened[0],
      false,
      async () => null,
    );
    expect(rootRevealed.map((entry) => entry.path)).toEqual([
      "root",
      "root/nested",
    ]);
    expect(decodeStoredEntry).toHaveBeenCalledTimes(1);
    expect(decodeStoredEntry.mock.calls[0][3]).toBe(0);

    const nested = rootRevealed.find((entry) => entry.path === "root/nested")!;
    const revealed = await codec.reveal!(nested, false, async () => null);
    expect(revealed.map((entry) => entry.path)).toEqual([
      "root",
      "root/nested",
      "root/nested/deep.txt",
    ]);
    expect(decodeStoredEntry).toHaveBeenCalledTimes(2);
    expect(decodeStoredEntry.mock.calls[1][3]).toBe(1);
    await codec.reveal!(nested, false, async () => null);
    expect(decodeStoredEntry).toHaveBeenCalledTimes(2);
  });

  it("encodes entries one at a time and reads File content only when needed", async () => {
    const added = new File(["hello"], "hello.txt");
    const arrayBuffer = vi.spyOn(added, "arrayBuffer");
    const writes: Uint8Array[] = [];
    const codec = createMkarCodec({
      ...fakeBindings([]),
      planArchive: () => [
        {
          path: "hello.txt",
          name: "hello.txt",
          kind: "file",
          children: [],
          root: true,
        },
      ],
      encodePlannedEntry: (_plan, content) =>
        new Uint8Array([225, ...(content as Uint8Array)]),
    });

    await codec.encodeTo!(
      [
        {
          id: "added",
          name: "hello.txt",
          path: "hello.txt",
          kind: "file",
          source: { kind: "file", file: added },
        },
      ],
      { write: async (chunk) => void writes.push(chunk.slice()) },
    );

    expect(arrayBuffer).toHaveBeenCalledOnce();
    expect(writes.length).toBeGreaterThanOrEqual(3);
    expect(new TextDecoder().decode(writes.at(-1))).toContain("hello.txt");
  });

  it("keeps encrypted directories locked until explicitly revealed", async () => {
    const fstOffset = 16 + 229 + 225;
    const names = ["vault", "secret.txt"];
    const fstSize = names.reduce(
      (total, name) => total + 2 + name.length + 8,
      2,
    );
    const bytes = new Uint8Array(fstOffset + fstSize);
    bytes.set(new TextEncoder().encode("MKAR"), 0);
    bytes.set(new Uint8Array([9, 32, 2, 0]), 4);
    bytes.set(u64(fstOffset), 8);
    let cursor = fstOffset;
    for (const [index, name] of names.entries()) {
      new DataView(bytes.buffer).setUint16(cursor, name.length, true);
      cursor += 2;
      bytes.set(new TextEncoder().encode(name), cursor);
      cursor += name.length;
      bytes.set(u64(index === 0 ? 16 : 245), cursor);
      cursor += 8;
    }
    new DataView(bytes.buffer).setUint16(cursor, 0x8000, true);
    const decodeStoredEntry = vi.fn(
      (_stored, _version, _limits, _index, password?: string) => {
        if (!password) {
          throw Object.assign(new Error("Password required"), {
            code: "PASSWORD_REQUIRED",
            entry: 0,
            keyIndex: 7,
          });
        }
        if (password !== "correct") {
          throw Object.assign(new Error("Incorrect password"), {
            code: "INCORRECT_PASSWORD",
            entry: 0,
            keyIndex: 7,
          });
        }
        return {
          prop: 84,
          content: new Uint8Array([1, 0, 0, 0, 1, 0, 0, 0]),
        };
      },
    );
    const buildManifest = vi.fn((metadata: unknown) => {
      const items = metadata as Array<{ locked: boolean }>;
      return items[0].locked
        ? [
            {
              path: "vault",
              kind: "folder",
              sourceIndex: 0,
              size: 0,
              encrypted: true,
              locked: true,
              keyIndex: 7,
            },
          ]
        : [
            {
              path: "vault",
              kind: "folder",
              sourceIndex: 0,
              size: 0,
              encrypted: true,
              locked: false,
              keyIndex: 7,
            },
            {
              path: "vault/secret.txt",
              kind: "file",
              sourceIndex: 1,
              size: 0,
              encrypted: false,
              locked: false,
            },
          ];
    });
    const codec = createMkarCodec({
      ...fakeBindings([]),
      inspectEntryMetadata: (_input, _version, index) =>
        index === 0 ? { prop: 84, keyIndex: 7 } : { prop: 0 },
      decodeStoredEntry,
      buildManifest,
    });
    const requestPassword = vi.fn(async () => "correct");

    const opened = await codec.open!(new File([bytes], "locked.mkar"));
    expect(opened).toEqual([
      expect.objectContaining({ path: "vault", locked: true }),
    ]);
    expect(requestPassword).not.toHaveBeenCalled();
    expect(decodeStoredEntry).not.toHaveBeenCalled();

    const revealed = await codec.reveal!(opened[0], false, requestPassword);
    expect(requestPassword).toHaveBeenCalledWith(7, false);
    expect(revealed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "vault", locked: false }),
        expect.objectContaining({ path: "vault/secret.txt" }),
      ]),
    );
    await codec.read!(opened[0], requestPassword);
    await codec.read!(opened[0], requestPassword);
    expect(requestPassword).toHaveBeenCalledTimes(1);
  });
});
