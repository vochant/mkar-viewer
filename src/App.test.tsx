// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App, { importedArchiveName } from "./App";
import { MkarError, type MkarCodec } from "./mkarCodec";

afterEach(() => {
  cleanup();
  localStorage.removeItem("mkar-language");
});

describe("MKAR lifecycle", () => {
  it("limits explicit selection mode to touch devices and translates its controls", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    localStorage.setItem("mkar-language", "zh-CN");
    try {
      const user = userEvent.setup();
      const codec: MkarCodec = { decode: async () => [], encode: async () => new Uint8Array() };
      const { container } = render(<App codecLoader={() => Promise.resolve(codec)} />);
      await user.upload(container.querySelector('input[type="file"][multiple]') as HTMLInputElement, new File(["text"], "touch.txt"));
      const checkbox = container.querySelector('.row .entry-check') as HTMLInputElement;
      expect(checkbox.classList.contains("selection-check-hidden")).toBe(true);
      await user.click(screen.getByText("touch.txt"));
      expect(checkbox.checked).toBe(false);
      await user.click(screen.getByRole("button", { name: "选择" }));
      expect(checkbox.classList.contains("selection-check-hidden")).toBe(false);
      await user.click(screen.getByText("touch.txt"));
      expect(checkbox.checked).toBe(true);
      await user.click(screen.getByRole("button", { name: "退出选择" }));
      expect(checkbox.checked).toBe(false);
      expect(checkbox.classList.contains("selection-check-hidden")).toBe(true);
    } finally {
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  it("keeps desktop selection available without a selection-mode button", async () => {
    const user = userEvent.setup();
    const codec: MkarCodec = { decode: async () => [], encode: async () => new Uint8Array() };
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    await user.upload(screen.getByLabelText("Add files"), new File(["text"], "desktop.txt"));
    const checkbox = screen.getByRole("checkbox", { name: "Select desktop.txt" }) as HTMLInputElement;
    expect(checkbox.classList.contains("selection-check-hidden")).toBe(false);
    expect(checkbox.checked).toBe(false);
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
    await user.click(screen.getByText("desktop.txt"));
    expect(checkbox.checked).toBe(true);
    expect(checkbox.closest(".row")?.classList.contains("selected")).toBe(true);
    await user.click(screen.getByText("desktop.txt"));
    expect(checkbox.checked).toBe(false);
    await user.click(checkbox);
    expect(checkbox.closest(".row")?.classList.contains("selected")).toBe(true);
  });

  it("derives the editable archive name from only the final MKAR suffix", () => {
    expect(importedArchiveName("aaa.mkar")).toBe("aaa");
    expect(importedArchiveName("asdfasdf.custom")).toBe("asdfasdf.custom");
    expect(importedArchiveName("nosuffix")).toBe("nosuffix");
    expect(importedArchiveName("a.mkar.mkar")).toBe("a.mkar");
  });

  it("starts as an empty viewer with a clear open action", async () => {
    const codec: MkarCodec = {
      decode: async () => [],
      encode: async () => new Uint8Array(),
    };
    render(<App codecLoader={() => Promise.resolve(codec)} />);

    await screen.findByText("Ready");

    expect(screen.getByRole("heading", { name: "MKAR" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open MKAR" })).toBeTruthy();
    expect(screen.getByRole("banner").textContent).toContain("MKAR");
    expect(screen.getByRole("banner").textContent).not.toContain("Ready");
    expect(screen.queryByText("README.md")).toBeNull();
    expect(screen.getAllByText("No archive open").length).toBeGreaterThan(0);
    const archiveName = screen.getByLabelText("Archive name") as HTMLInputElement;
    expect(archiveName.value).toBe("");
    expect(archiveName.placeholder).toBe("untitled");
  });

  it("switches interface language", async () => {
    const codec: MkarCodec = {
      decode: async () => [],
      encode: async () => new Uint8Array(),
    };
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Language" }),
      "zh-CN",
    );
    expect(screen.getByRole("button", { name: "打开 MKAR" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "未打开归档" })).toBeTruthy();
  });

  it("updates the current status when the language changes", async () => {
    const codec: MkarCodec = {
      decode: async () => [],
      encode: async () => new Uint8Array(),
    };
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    await user.upload(
      screen.getByLabelText("Add files"),
      new File(["hello"], "hello.txt"),
    );
    expect(screen.getByText("1 file(s) added")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Unsaved changes" })).toBeTruthy();
    expect(screen.getByRole("banner").textContent).not.toContain(
      "Unsaved changes",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Language" }),
      "zh-CN",
    );
    expect(screen.getByText("已添加 1 个文件")).toBeTruthy();
  });

  it("keeps archive actions and compact export formats in the viewer toolbar", async () => {
    const codec: MkarCodec = {
      decode: async () => [],
      encode: async () => new Uint8Array(),
    };
    render(<App codecLoader={() => Promise.resolve(codec)} />);

    await screen.findByText("Ready");

    const toolbar = screen.getByRole("toolbar");
    expect(toolbar.querySelector('[aria-label="Export format"]')).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Export selection",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(toolbar.textContent).not.toContain("Export MKAR");
    expect(screen.getByRole("button", { name: "Export MKAR" })).toBeTruthy();
    expect(toolbar.textContent).toContain("Open");
    expect(toolbar.textContent).not.toContain("Export as");
    expect(screen.queryByText("ARCHIVE VIEWER")).toBeNull();
    expect(
      screen.queryByText("Open an MKAR archive or add files to create one."),
    ).toBeNull();
    const formats = screen.getByRole("combobox", {
      name: "Export format",
    }) as HTMLSelectElement;
    expect([...formats.options].map((option) => option.text)).toEqual([
      ".mkar",
      ".zip",
      ".7z",
      ".tar",
      ".tar.gz",
      ".tar.bz2",
      ".tar.xz",
      ".tar.zst",
      ".tar.lz4",
      ".tar.lzma",
      ".tar.lz",
      ".tar.Z",
      ".tar.uu",
      ".tar.b64",
      ".tar.xx",
      ".tar.br",
      ".asar",
      ".cpio",
      ".xar",
      ".iso",
      ".shar",
      ".cab",
      ".lzh",
      ".a",
    ]);
  });

  it("keeps existing files when MKAR decode fails", async () => {
    const codec: MkarCodec = {
      decode: async () => {
        throw new MkarError("bad bytes", "INVALID_ARCHIVE");
      },
      encode: async () => new Uint8Array(),
    };
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");

    await user.upload(
      screen.getByLabelText("Add files"),
      new File(["keep"], "keep.txt", { type: "text/plain" }),
    );

    await user.upload(
      screen.getByLabelText("Import mkar"),
      new File([new Uint8Array([0])], "bad.mkar", {
        type: "application/octet-stream",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText("Invalid MKAR archive")).toBeTruthy();
    expect(screen.getByText("keep.txt")).toBeTruthy();
  });

  it("shows one folder at a time and navigates back", async () => {
    const codec: MkarCodec = {
      decode: async () => [
        {
          id: "root",
          name: "root",
          path: "root",
          kind: "folder",
        },
        {
          id: "nested",
          name: "nested",
          path: "root/nested",
          kind: "folder",
        },
        {
          id: "deep",
          name: "deep.txt",
          path: "root/nested/deep.txt",
          kind: "file",
          content: new Uint8Array([65]),
        },
      ],
      encode: async () => new Uint8Array(),
    };
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");

    await user.upload(
      screen.getByLabelText("Import mkar"),
      new File([new Uint8Array([1])], "nested.mkar"),
    );

    expect(await screen.findByText("root/")).toBeTruthy();
    expect(screen.queryByText("nested/")).toBeNull();
    await user.dblClick(screen.getByRole("button", { name: "root/" }));
    expect(await screen.findByText("nested/")).toBeTruthy();
    expect(screen.queryByText("deep.txt")).toBeNull();
    await user.dblClick(screen.getByRole("button", { name: "nested/" }));
    expect(await screen.findByText("deep.txt")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("nested/")).toBeTruthy();
    expect(screen.queryByText("deep.txt")).toBeNull();
  });

  it("uses an app dialog before clearing a modified workspace", async () => {
    const codec: MkarCodec = {
      decode: async () => [],
      encode: async () => new Uint8Array(),
    };
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");

    await user.upload(
      screen.getByLabelText("Add files"),
      new File(["hello"], "hello.txt", { type: "text/plain" }),
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByRole("dialog", { name: "Confirm" })).toBeTruthy();
    expect(screen.getByText("This action cannot be undone. Continue?")).toBeTruthy();
    expect(screen.getByText("hello.txt")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Confirm" })).toBeNull();
    expect(screen.getByText("hello.txt")).toBeTruthy();
  });

  it("asks before clearing a non-empty imported workspace", async () => {
    const codec: MkarCodec = {
      decode: async () => [
        { id: "saved", name: "saved.txt", path: "saved.txt", kind: "file", content: new Uint8Array([1]) },
      ],
      encode: async () => new Uint8Array(),
    };
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    await user.upload(screen.getByLabelText("Import mkar"), new File(["archive"], "saved.mkar"));
    expect(await screen.findByText("saved.txt")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByRole("dialog", { name: "Confirm" })).toBeTruthy();
    expect(screen.getByText("saved.txt")).toBeTruthy();
  });

  it("opens only a drag containing exactly one MKAR file", async () => {
    const decode = vi.fn(async () => [
      { id: "inside", name: "inside.txt", path: "inside.txt", kind: "file" as const, content: new Uint8Array([1]) },
    ]);
    const codec: MkarCodec = { decode, encode: async () => new Uint8Array() };
    const { container } = render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    const archive = new File(["archive"], "one.mkar");

    fireEvent.drop(container.querySelector(".app-shell") as HTMLElement, {
      dataTransfer: {
        files: [archive],
        items: [{ kind: "file", getAsFile: () => archive }],
      },
    });

    expect(await screen.findByText("inside.txt")).toBeTruthy();
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("adds mixed and multiple MKAR drags instead of opening them", async () => {
    const decode = vi.fn(async () => []);
    const codec: MkarCodec = { decode, encode: async () => new Uint8Array() };
    const { container } = render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    const first = new File(["a"], "first.mkar");
    const second = new File(["b"], "second.mkar");

    fireEvent.drop(container.querySelector(".app-shell") as HTMLElement, {
      dataTransfer: {
        files: [first, second],
        items: [
          { kind: "file", getAsFile: () => first },
          { kind: "file", getAsFile: () => second },
        ],
      },
    });

    expect(await screen.findByText("first.mkar")).toBeTruthy();
    expect(screen.getByText("second.mkar")).toBeTruthy();
    expect(decode).not.toHaveBeenCalled();
  });

  it("adds an MKAR dragged together with a regular file", async () => {
    const decode = vi.fn(async () => []);
    const codec: MkarCodec = { decode, encode: async () => new Uint8Array() };
    const { container } = render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    const archive = new File(["a"], "archive.mkar");
    const text = new File(["b"], "note.txt");

    fireEvent.drop(container.querySelector(".app-shell") as HTMLElement, {
      dataTransfer: {
        files: [archive, text],
        items: [
          { kind: "file", getAsFile: () => archive },
          { kind: "file", getAsFile: () => text },
        ],
      },
    });

    expect(await screen.findByText("archive.mkar")).toBeTruthy();
    expect(screen.getByText("note.txt")).toBeTruthy();
    expect(decode).not.toHaveBeenCalled();
  });

  it("captures every modern file-system handle before drag data expires", async () => {
    const codec: MkarCodec = { decode: async () => [], encode: async () => new Uint8Array() };
    const { container } = render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    const first = new File(["a"], "first.txt");
    const second = new File(["b"], "second.txt");
    let dragDataReadable = true;
    const firstHandle = {
      kind: "file",
      name: first.name,
      getFile: async () => first,
    };
    const secondHandle = {
      kind: "file",
      name: second.name,
      getFile: async () => second,
    };

    fireEvent.drop(container.querySelector(".app-shell") as HTMLElement, {
      dataTransfer: {
        files: [first, second],
        items: [
          {
            kind: "file",
            getAsFile: () => (dragDataReadable ? first : null),
            getAsFileSystemHandle: () => {
              queueMicrotask(() => {
                dragDataReadable = false;
              });
              return Promise.resolve(firstHandle);
            },
          },
          {
            kind: "file",
            getAsFile: () => (dragDataReadable ? second : null),
            getAsFileSystemHandle: () =>
              Promise.resolve(dragDataReadable ? secondHandle : null),
          },
        ],
      },
    });

    expect(await screen.findByText("first.txt")).toBeTruthy();
    expect(await screen.findByText("second.txt")).toBeTruthy();
  });

  it("asks before opening a dropped MKAR over a non-empty workspace", async () => {
    const decode = vi.fn(async () => [
      { id: "opened", name: "opened.txt", path: "opened.txt", kind: "file" as const, content: new Uint8Array([1]) },
    ]);
    const codec: MkarCodec = { decode, encode: async () => new Uint8Array() };
    const user = userEvent.setup();
    const { container } = render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    await user.upload(screen.getByLabelText("Add files"), new File(["keep"], "keep.txt"));
    const archive = new File(["archive"], "next.mkar");

    fireEvent.drop(container.querySelector(".app-shell") as HTMLElement, {
      dataTransfer: {
        files: [archive],
        items: [{ kind: "file", getAsFile: () => archive }],
      },
    });

    expect(screen.getByRole("dialog", { name: "Confirm" })).toBeTruthy();
    expect(screen.getByText("keep.txt")).toBeTruthy();
    expect(decode).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("opened.txt")).toBeTruthy();
    expect(screen.queryByText("keep.txt")).toBeNull();
  });

  it("recursively adds a dropped directory instead of treating it as a file", async () => {
    const codec: MkarCodec = { decode: async () => [], encode: async () => new Uint8Array() };
    const { container } = render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    const child = new File(["hello"], "child.txt");
    const fileEntry = {
      isFile: true,
      isDirectory: false,
      name: "child.txt",
      file: (success: (file: File) => void) => success(child),
    };
    let read = false;
    const directoryEntry = {
      isFile: false,
      isDirectory: true,
      name: "folder",
      createReader: () => ({
        readEntries: (success: (entries: unknown[]) => void) => {
          success(read ? [] : [fileEntry]);
          read = true;
        },
      }),
    };

    fireEvent.drop(container.querySelector(".app-shell") as HTMLElement, {
      dataTransfer: {
        files: [],
        items: [{ kind: "file", webkitGetAsEntry: () => directoryEntry }],
      },
    });

    expect(await screen.findByText("folder/")).toBeTruthy();
    fireEvent.doubleClick(screen.getByRole("button", { name: "folder/" }));
    expect(await screen.findByText("child.txt")).toBeTruthy();
  });

  it("opens the native file and folder pickers directly", async () => {
    const codec: MkarCodec = { decode: async () => [], encode: async () => new Uint8Array() };
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    const fileInput = screen.getByLabelText("Add files") as HTMLInputElement;
    const folderInput = screen.getByLabelText("Add folder") as HTMLInputElement;
    const fileClick = vi.spyOn(fileInput, "click");
    const folderClick = vi.spyOn(folderInput, "click");

    await user.click(screen.getByRole("button", { name: "Add files" }));
    expect(fileClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Add files" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Add folder" }));
    expect(folderClick).toHaveBeenCalledOnce();
  });

  it("preserves relative paths from the folder picker fallback", async () => {
    const codec: MkarCodec = { decode: async () => [], encode: async () => new Uint8Array() };
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    const child = new File(["hello"], "child.txt");
    Object.defineProperty(child, "webkitRelativePath", { value: "folder/child.txt" });

    await user.upload(screen.getByLabelText("Add folder"), child);

    expect(await screen.findByText("folder/")).toBeTruthy();
    await user.dblClick(screen.getByRole("button", { name: "folder/" }));
    expect(await screen.findByText("child.txt")).toBeTruthy();
  });

  it("preserves an empty folder selected through the directory picker", async () => {
    vi.stubGlobal("showDirectoryPicker", vi.fn(async () => ({
      kind: "directory",
      name: "empty-folder",
      async *values() {},
    })));
    try {
      const codec: MkarCodec = { decode: async () => [], encode: async () => new Uint8Array() };
      const user = userEvent.setup();
      render(<App codecLoader={() => Promise.resolve(codec)} />);
      await screen.findByText("Ready");

      await user.click(screen.getByRole("button", { name: "Add folder" }));

      expect(await screen.findByText("empty-folder/")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("blocks browser exit after a workspace change", async () => {
    const codec: MkarCodec = {
      decode: async () => [],
      encode: async () => new Uint8Array(),
    };
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    await user.upload(
      screen.getByLabelText("Add files"),
      new File(["hello"], "hello.txt", { type: "text/plain" }),
    );

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it("exports the whole workspace as MKAR and marks it saved", async () => {
    const encode = vi.fn(async () => new Uint8Array([77, 75, 65, 82]));
    const codec: MkarCodec = { decode: async () => [], encode };
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:test");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    await user.upload(screen.getByLabelText("Add files"), [
      new File(["a"], "a.txt"),
      new File(["b"], "b.txt"),
    ]);

    await user.click(screen.getByRole("button", { name: "Export MKAR" }));

    expect(encode).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ path: "a.txt" }),
        expect.objectContaining({ path: "b.txt" }),
      ]),
      {},
    );
    expect(screen.queryByText("Unsaved")).toBeNull();
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
    click.mockRestore();
  });

  it("exports imported and newly added files together", async () => {
    const encodeTo = vi.fn<NonNullable<MkarCodec["encodeTo"]>>(
      async (_entries, output) => {
        await output.write(new Uint8Array([77, 75, 65, 82]));
      },
    );
    const codec: MkarCodec = {
      decode: async () => [],
      encode: async () => new Uint8Array(),
      open: async () => [
        {
          id: "old",
          name: "old.txt",
          path: "old.txt",
          kind: "file",
          content: new Uint8Array([111, 108, 100]),
        },
      ],
      encodeTo,
    };
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mixed");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");

    await user.upload(
      screen.getByLabelText("Import mkar"),
      new File(["archive"], "source.mkar"),
    );
    await user.upload(
      screen.getByLabelText("Add files"),
      new File(["new"], "new.txt"),
    );
    await user.click(screen.getByRole("button", { name: "Export MKAR" }));

    expect(encodeTo).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ path: "old.txt" }),
        expect.objectContaining({ path: "new.txt" }),
      ]),
      expect.anything(),
      {},
      expect.any(Function),
      expect.any(Function),
    );
    expect(
      (screen.getByLabelText("Archive name") as HTMLInputElement).value,
    ).toBe("source");
    expect(screen.queryByText("Unsaved")).toBeNull();
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
    click.mockRestore();
  });

  it("exports only checked entries when a partial selection is made", async () => {
    const encode = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const encodeStandard = vi.fn(async () => new Uint8Array([80, 75, 3, 4]));
    const codec: MkarCodec = {
      decode: async () => [],
      encode,
      encodeStandard,
    };
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:selection");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    await user.upload(screen.getByLabelText("Add files"), [
      new File(["a"], "a.txt"),
      new File(["b"], "b.txt"),
    ]);
    await user.click(screen.getByRole("checkbox", { name: "Select a.txt" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Export format" }),
      "zip",
    );
    await user.click(screen.getByRole("button", { name: "Export selection" }));

    expect(encode).not.toHaveBeenCalled();
    expect(encodeStandard).toHaveBeenCalledWith("zip", [
      expect.objectContaining({ path: "a.txt" }),
    ], { variant: "gnu" }, expect.any(Function));
    expect(screen.getByText("a.txt")).toBeTruthy();
    expect(screen.getByText("b.txt")).toBeTruthy();
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
    click.mockRestore();
  });

  it("uses the save dialog for non-MKAR exports when available", async () => {
    const encodeStandard = vi.fn(async () => new Uint8Array([80, 75, 3, 4]));
    const write = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const codec: MkarCodec = { decode: async () => [], encode: async () => new Uint8Array(), encodeStandard };
    const showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({
        write,
        seek: vi.fn(async () => undefined),
        close,
        abort: vi.fn(async () => undefined),
      }),
    }));
    Object.defineProperty(window, "showSaveFilePicker", {
      configurable: true,
      value: showSaveFilePicker,
    });
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    await user.upload(
      screen.getByLabelText("Add files"),
      new File(["a"], "a.txt"),
    );
    await user.click(screen.getByRole("checkbox", { name: "Select a.txt" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Export format" }),
      "zip",
    );
    await user.click(screen.getByRole("button", { name: "Export selection" }));

    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: "untitled.zip",
    });
    expect(encodeStandard).toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(expect.any(Blob));
    expect(close).toHaveBeenCalled();
    delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });

  it("rebases selected entries to the current directory", async () => {
    const encodeStandard = vi.fn(async () => new Uint8Array([80, 75, 3, 4]));
    const codec: MkarCodec = {
      decode: async () => [],
      encode: async () => new Uint8Array(),
      encodeStandard,
      open: async () => [
        { id: "a", name: "a", path: "a", kind: "folder" },
        { id: "b", name: "b", path: "a/b", kind: "folder" },
        { id: "c", name: "c", path: "a/b/c", kind: "file", content: new Uint8Array([1]) },
        { id: "d", name: "d", path: "a/b/d", kind: "file", content: new Uint8Array([2]) },
      ],
    };
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:selection");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    await user.upload(
      screen.getByLabelText("Import mkar"),
      new File([new Uint8Array([1])], "source.mkar"),
    );
    await user.dblClick(screen.getByRole("button", { name: "a/" }));
    await user.dblClick(screen.getByRole("button", { name: "b/" }));
    await user.click(screen.getByRole("checkbox", { name: "Select c" }));
    await user.click(screen.getByRole("checkbox", { name: "Select d" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Export format" }),
      "zip",
    );
    await user.click(screen.getByRole("button", { name: "Export selection" }));

    expect(encodeStandard).toHaveBeenCalledWith("zip", [
      expect.objectContaining({ path: "c" }),
      expect.objectContaining({ path: "d" }),
    ], { variant: "gnu" }, expect.any(Function));
  });

  it("downloads a file without passing it through an archive encoder", async () => {
    const encode = vi.fn(async () => new Uint8Array([77, 75, 65, 82]));
    const codec: MkarCodec = { decode: async () => [], encode };
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:file");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const downloads: string[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.download);
      });
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    await user.upload(
      screen.getByLabelText("Add files"),
      new File(["contents"], "raw.txt", { type: "text/plain" }),
    );

    await user.click(screen.getByRole("button", { name: "Download raw.txt" }));

    expect(downloads).toEqual(["raw.txt"]);
    expect(encode).not.toHaveBeenCalled();
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
    click.mockRestore();
  });

  it("exports a directory's contents using the selected format and its name", async () => {
    const encodeStandard = vi.fn(async () => new Uint8Array([80, 75, 3, 4]));
    const codec: MkarCodec = {
      decode: async () => [],
      encode: async () => new Uint8Array(),
      encodeStandard,
      open: async () => [
        { id: "a", name: "a", path: "a", kind: "folder" },
        { id: "b", name: "b", path: "a/b", kind: "folder" },
        { id: "c", name: "c", path: "a/b/c", kind: "file", content: new Uint8Array([1]) },
        { id: "d", name: "d", path: "a/b/d", kind: "file", content: new Uint8Array([2]) },
      ],
    };
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:folder");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        downloads.push(this.download);
      },
    );
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    await user.upload(
      screen.getByLabelText("Import mkar"),
      new File([new Uint8Array([1])], "source.mkar"),
    );
    await user.dblClick(screen.getByRole("button", { name: "a/" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Export format" }),
      "zip",
    );

    await user.click(screen.getByRole("button", { name: "Download b/" }));

    expect(downloads).toContain("b.zip");
    expect(encodeStandard).toHaveBeenCalledWith("zip", [
      expect.objectContaining({ path: "c" }),
      expect.objectContaining({ path: "d" }),
    ], { variant: "gnu" }, expect.any(Function));
    expect(screen.getByTitle("a")).toBeTruthy();
  });

  it("selects every visible entry in the current folder", async () => {
    const codec: MkarCodec = {
      decode: async () => [],
      encode: async () => new Uint8Array(),
    };
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    await user.upload(screen.getByLabelText("Add files"), [
      new File(["a"], "a.txt"),
      new File(["b"], "b.txt"),
    ]);

    await user.click(
      screen.getByRole("checkbox", { name: "Select all in current folder" }),
    );

    expect(
      (
        screen.getByRole("checkbox", {
          name: "Select a.txt",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Select b.txt",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Export selection",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("always exports the whole archive from the title row", async () => {
    const codec: MkarCodec = {
      decode: async () => [
        {
          id: "root",
          name: "root",
          path: "root",
          kind: "folder",
        },
        {
          id: "child",
          name: "child.txt",
          path: "root/child.txt",
          kind: "file",
          content: new Uint8Array([1]),
        },
      ],
      encode: async () => new Uint8Array([77, 75, 65, 82]),
    };
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:named");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const downloads: string[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.download);
      });
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    await user.upload(
      screen.getByLabelText("Import mkar"),
      new File(["archive"], "a.mkar.mkar"),
    );

    await user.click(screen.getByRole("button", { name: "Export MKAR" }));
    await user.dblClick(screen.getByRole("button", { name: "root/" }));
    await user.click(screen.getByRole("button", { name: "Export MKAR" }));

    expect(downloads).toEqual(["a.mkar.mkar", "a.mkar.mkar"]);
    createObjectUrl.mockRestore();
    revokeObjectUrl.mockRestore();
    click.mockRestore();
  });

  it("assigns packing passwords to selected paths by key index", async () => {
    const encode = vi.fn(async () => new Uint8Array([77, 75, 65, 82]));
    const codec: MkarCodec = { decode: async () => [], encode };
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:encrypted");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    const user = userEvent.setup();
    render(<App codecLoader={() => Promise.resolve(codec)} />);
    await screen.findByText("Ready");
    await user.upload(
      screen.getByLabelText("Add files"),
      new File(["secret"], "secret.txt"),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Select secret.txt" }),
    );
    await user.click(screen.getByRole("button", { name: "Global settings" }));
    await user.clear(screen.getByLabelText("Key index"));
    await user.type(screen.getByLabelText("Key index"), "7");
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.type(screen.getByLabelText("Confirm"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByLabelText("Enable encryption"));
    await user.selectOptions(screen.getByLabelText("Default packing key"), "7");
    await user.click(screen.getByLabelText("Encrypt directory listings"));
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await user.click(
      screen.getByRole("button", { name: "Settings for secret.txt" }),
    );
    await user.selectOptions(
      screen.getByLabelText("Encryption setting for secret.txt"),
      "key",
    );
    await user.selectOptions(
      screen.getByLabelText("Packing key for secret.txt"),
      "7",
    );
    await user.selectOptions(
      screen.getByLabelText("Compression setting for secret.txt"),
      "on",
    );
    await user.click(screen.getByRole("button", { name: "Save settings" }));
    await user.click(screen.getByRole("button", { name: "Export selection" }));

    expect(encode).toHaveBeenCalledWith(
      [expect.objectContaining({ path: "secret.txt" })],
      {
        compress: false,
        compressionAssignments: [{ path: "secret.txt", enabled: true }],
        encryption: {
          enabled: true,
          defaultKeyIndex: 7,
          keys: [{ index: 7, password: "hunter2" }],
          assignments: [{ path: "secret.txt", keyIndex: 7 }],
          encryptDirectories: true,
        },
      },
    );
  });
});
