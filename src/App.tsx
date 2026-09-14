import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  ArrowLeft,
  Download,
  File,
  FileArchive,
  Folder,
  LockKeyhole,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  ShieldOff,
  Trash2,
  X,
} from "lucide-react";
import { encodeArchive } from "./archive";
import {
  loadMkarCodec,
  MkarError,
  type MkarCodec,
  type MkarEncodeOptions,
  type ReadPasswordRequest,
  type TarVariant,
} from "./mkarCodec";
import {
  ConfirmDialog,
  AboutDialog,
  EncryptionDialog,
  EntrySettingsDialog,
  PasswordDialog,
  type CompressionAssignment,
  type EntryCompressionSetting,
  type EntryEncryptionSetting,
  type PackingAssignment,
  type PackingKey,
} from "./Dialogs";
import type { ArchiveFormat, FsEntry } from "./types";
import { I18nProvider, languageOptions, useI18n, type Language } from "./i18n";

const FORMAT_OPTIONS: ArchiveFormat[] = [
  "mkar",
  "zip",
  "7z",
  "tar.gz",
  "tar.bz2",
  "tar.xz",
  "tar.br",
  "tar.zst",
  "tar.lz4",
  "tar.lzma",
  "tar.lz",
  "tar",
  "cab",
  "lzh",
  "cpio",
  "ar",
];

function extensionFor(format: ArchiveFormat) {
  switch (format) {
    case "ar":
      return "a";
    case "tar.gz":
      return "tar.gz";
    case "tar.bz2":
      return "tar.bz2";
    case "tar.lz4":
      return "tar.lz4";
    case "tar.lzma":
      return "tar.lzma";
    case "tar.lz":
      return "tar.lz";
    case "cpio":
      return "cpio";
    default:
      return format;
  }
}

export default function App({ codecLoader = loadMkarCodec }: AppProps) {
  return (
    <I18nProvider>
      <AppView codecLoader={codecLoader} />
    </I18nProvider>
  );
}

function iconFor(entry: FsEntry) {
  if (entry.kind === "folder") return <Folder size={17} />;
  return entry.path.endsWith(".mkar") ? (
    <FileArchive size={17} />
  ) : (
    <File size={17} />
  );
}

function mkarMode(entry: FsEntry) {
  if (entry.source?.kind !== "mkar") return "";
  const prop = entry.source.prop;
  return [
    [32, "C"],
    [64, "E"],
    [4, "D"],
    [8, "L"],
    [1, "N"],
    [16, "R"],
    [2, "S"],
  ]
    .filter(([bit]) => prop & Number(bit))
    .map(([, mode]) => mode)
    .join("");
}

function mkarFsid(entry: FsEntry) {
  return entry.source?.kind === "mkar" ? String(entry.source.sourceIndex) : "";
}

function parentPath(path: string) {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function entryName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function importedArchiveName(fileName: string) {
  return fileName.replace(/\.mkar$/i, "") || "untitled";
}

function downloadBaseName(value: string) {
  return value.trim().replaceAll(/[\\/]/g, "_") || "untitled";
}

function rebaseEntry(entry: FsEntry, root: string) {
  if (!root) return entry;
  const prefix = `${root}/`;
  if (entry.path === root) return { ...entry, path: entry.name };
  if (!entry.path.startsWith(prefix)) return entry;
  return { ...entry, path: entry.path.slice(prefix.length) };
}

function rebasePath(path: string, root: string) {
  if (!root) return path;
  const prefix = `${root}/`;
  if (path === root) return "";
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function rebaseAssignments<T extends { path: string }>(
  assignments: T[],
  root: string,
  scopePaths: string[],
  entryPaths: string[] = scopePaths,
) {
  if (!root) return assignments;
  const rebased = new Map<string, T>();

  for (const scopePath of entryPaths) {
    const inherited = assignments
      .filter(
        (assignment) =>
          scopePath === assignment.path ||
          scopePath.startsWith(`${assignment.path}/`),
      )
      .sort((left, right) => left.path.length - right.path.length)
      .at(-1);
    if (inherited) {
      const path = rebasePath(scopePath, root);
      if (path) rebased.set(path, { ...inherited, path });
    }
  }

  for (const assignment of assignments) {
    if (
      !scopePaths.some(
        (scopePath) =>
          assignment.path === scopePath ||
          assignment.path.startsWith(`${scopePath}/`),
      )
    ) {
      continue;
    }
    const path = rebasePath(assignment.path, root);
    if (path) rebased.set(path, { ...assignment, path });
  }

  return [...rebased.values()];
}

function withInferredFolders(entries: FsEntry[]) {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const entry of entries) {
    let parent = parentPath(entry.path);
    while (parent) {
      if (!byPath.has(parent)) {
        byPath.set(parent, {
          id: `local-folder-${parent}`,
          name: entryName(parent),
          path: parent,
          kind: "folder",
        });
      }
      parent = parentPath(parent);
    }
  }
  return [...byPath.values()];
}

function toArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

type BrowserWritable = {
  write(data: Uint8Array | Blob): Promise<void>;
  seek(position: number): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};

type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types?: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<SaveFileHandle>;
};

type SaveFileHandle = {
  createWritable(): Promise<BrowserWritable>;
};

async function chooseSaveFile(name: string): Promise<SaveFileHandle | null> {
  const picker = (window as SavePickerWindow).showSaveFilePicker;
  if (!picker) return null;
  // Do not provide a MIME filter here. Native pickers may append the MIME's
  // default suffix (for application/octet-stream this can be ".com"), even
  // when suggestedName already contains a compound archive suffix.
  return picker({ suggestedName: name });
}

async function saveBlob(
  name: string,
  blob: Blob,
  handle: SaveFileHandle | null,
) {
  if (handle) {
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
      return;
    } catch (error) {
      try {
        await writable.abort();
      } catch {
        // The stream may already be closed after a write failure.
      }
      throw error;
    }
  }

  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

async function saveProgressiveMkar(
  name: string,
  entries: FsEntry[],
  codec: MkarCodec,
  options: MkarEncodeOptions,
  requestPassword: ReadPasswordRequest,
  onProgress: (completed: number, total: number) => void,
  handle: SaveFileHandle | null,
) {
  if (!codec.encodeTo) return false;
  if (handle) {
    const writable = await handle.createWritable();
    try {
      await codec.encodeTo(
        entries,
        {
          write: (chunk) => writable.write(chunk),
          seek: (position) => writable.seek(position),
        },
        options,
        ({ completed, total }) => onProgress(completed, total),
        requestPassword,
      );
      await writable.close();
      return true;
    } catch (error) {
      try {
        await writable.abort();
      } catch {
        // The stream may already be closed after a write failure.
      }
      throw error;
    }
  }

  const parts: ArrayBuffer[] = [];
  await codec.encodeTo(
    entries,
    { write: async (chunk) => void parts.push(toArrayBuffer(chunk)) },
    options,
    ({ completed, total }) => onProgress(completed, total),
    requestPassword,
  );
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(
    new Blob(parts, { type: "application/octet-stream" }),
  );
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
  return true;
}

type CodecState =
  | { status: "loading" }
  | { status: "ready"; codec: MkarCodec }
  | { status: "unavailable"; message: string };

type AppProps = {
  codecLoader?: () => Promise<MkarCodec>;
};

type Notice =
  { key: string; vars?: Record<string, string | number> } | { text: string };

function codecErrorNotice(error: unknown): Notice {
  if (!(error instanceof MkarError)) {
    return error instanceof Error
      ? { text: error.message }
      : { key: "operationFailed" };
  }
  switch (error.code) {
    case "INVALID_ARCHIVE":
      return { key: "invalidArchive" };
    case "PASSWORD_REQUIRED":
      return { key: "passwordRequired" };
    case "LIMIT_EXCEEDED":
      return { key: "limitExceeded" };
    case "UNSUPPORTED_FEATURE":
      return { key: "unsupportedFeature" };
    default:
      return { text: error.message };
  }
}

function AppView({ codecLoader = loadMkarCodec }: AppProps) {
  const { language, setLanguage, t } = useI18n();
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentPath, setCurrentPath] = useState("");
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<ArchiveFormat>("mkar");
  const [notice, setNotice] = useState<Notice>({ key: "noArchive" });
  const noticeText = "key" in notice ? t(notice.key, notice.vars) : notice.text;
  const [archiveName, setArchiveName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [packingKeys, setPackingKeys] = useState<PackingKey[]>([]);
  const [packingAssignments, setPackingAssignments] = useState<
    PackingAssignment[]
  >([]);
  const [compressionAssignments, setCompressionAssignments] = useState<
    CompressionAssignment[]
  >([]);
  const [encryptionEnabled, setEncryptionEnabled] = useState(false);
  const [defaultPackingKeyIndex, setDefaultPackingKeyIndex] = useState<
    number | null
  >(null);
  const [compressFiles, setCompressFiles] = useState(false);
  const [encryptDirectories, setEncryptDirectories] = useState(false);
  const [tarVariant, setTarVariant] = useState<TarVariant>("gnu");
  const [encryptionOpen, setEncryptionOpen] = useState(false);
  const [entrySettingsOpen, setEntrySettingsOpen] = useState<FsEntry | null>(
    null,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [passwordDialog, setPasswordDialog] = useState<{
    keyIndex: number;
    incorrect: boolean;
    resolve: (password: string | null) => void;
  } | null>(null);
  const [codecState, setCodecState] = useState<CodecState>({
    status: "loading",
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const archiveRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [topbarCompact, setTopbarCompact] = useState(false);
  const discardActionRef = useRef<(() => void) | null>(null);
  const [toolbarCompact, setToolbarCompact] = useState(false);
  const [toolbarStacked, setToolbarStacked] = useState(false);
  const [tableActionsStacked, setTableActionsStacked] = useState(false);
  const [tableDetailsStacked, setTableDetailsStacked] = useState(false);

  const requestPassword = useCallback<ReadPasswordRequest>(
    (keyIndex, incorrect) =>
      new Promise((resolve) =>
        setPasswordDialog({ keyIndex, incorrect, resolve }),
      ),
    [],
  );

  useEffect(() => {
    let active = true;
    setCodecState({ status: "loading" });
    void codecLoader().then(
      (codec) => {
        if (active) setCodecState({ status: "ready", codec });
      },
      (error) => {
        if (!active) return;
        const message =
          error instanceof Error ? error.message : t("operationFailed");
        setCodecState({ status: "unavailable", message });
        setNotice({ key: "wasmInitFailed", vars: { message } });
      },
    );
    return () => {
      active = false;
    };
  }, [codecLoader]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useLayoutEffect(() => {
    const topbar = topbarRef.current;
    if (!topbar) return;
    const update = () => {
      const styles = getComputedStyle(topbar);
      const available =
        topbar.clientWidth -
        parseFloat(styles.paddingLeft) -
        parseFloat(styles.paddingRight);
      const clone = topbar.cloneNode(true) as HTMLElement;
      clone.className = "topbar";
      clone.style.position = "fixed";
      clone.style.left = "-100000px";
      clone.style.top = "0";
      clone.style.width = `${topbar.clientWidth}px`;
      clone.style.visibility = "hidden";
      document.body.appendChild(clone);
      const brand = clone.querySelector<HTMLElement>(".brand");
      const actions = clone.querySelector<HTMLElement>(".topbar-actions");
      const required =
        (brand?.scrollWidth ?? 0) +
        (actions?.scrollWidth ?? 0) +
        (parseFloat(styles.gap) || 0);
      clone.remove();
      setTopbarCompact(required > available + 1);
    };
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(update)
        : null;
    observer?.observe(topbar);
    if (!observer) window.addEventListener("resize", update);
    update();
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", update);
    };
  }, [language, dirty]);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const styles = getComputedStyle(toolbar);
      const available =
        toolbar.clientWidth -
        parseFloat(styles.paddingLeft) -
        parseFloat(styles.paddingRight);
      const measure = (className: string) => {
        const clone = toolbar.cloneNode(true) as HTMLElement;
        clone.className = className;
        clone.style.position = "fixed";
        clone.style.left = "-100000px";
        clone.style.top = "0";
        clone.style.width = `${toolbar.clientWidth}px`;
        clone.style.visibility = "hidden";
        document.body.appendChild(clone);
        const groups = Array.from(
          clone.querySelectorAll<HTMLElement>(
            ".command-group, .export-group",
          ),
        );
        const gap = parseFloat(getComputedStyle(clone).gap) || 0;
        const required =
          groups.reduce((total, group) => total + group.scrollWidth, 0) + gap;
        clone.remove();
        return required;
      };
      const needsCompact = measure("toolbar") > available + 1;
      const needsStacked = measure("toolbar toolbar-compact") > available + 1;
      setToolbarCompact(needsCompact);
      setToolbarStacked(needsStacked);
    };
    const observer = new ResizeObserver(update);
    observer.observe(toolbar);
    update();
    return () => observer.disconnect();
  }, [language]);

  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const update = () => {
      const clone = table.cloneNode(true) as HTMLElement;
      clone.className = "table-wrap";
      clone.style.position = "fixed";
      clone.style.left = "-100000px";
      clone.style.width = `${table.clientWidth}px`;
      clone.style.visibility = "hidden";
      document.body.appendChild(clone);
      const needsActions = clone.scrollWidth > clone.clientWidth + 1;
      if (needsActions) clone.classList.add("table-actions-stacked");
      const heading = clone.querySelector<HTMLElement>(".table-head > span:nth-child(2)");
      const needsDetails = needsActions && !!heading && heading.getBoundingClientRect().width < 96;
      clone.remove();
      setTableActionsStacked(needsActions);
      setTableDetailsStacked(needsDetails);
    };
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(update)
        : null;
    observer?.observe(table);
    if (!observer) window.addEventListener("resize", update);
    update();
    return () => {
      observer?.disconnect();
      if (!observer) window.removeEventListener("resize", update);
    };
  }, [currentPath, entries, language, query]);

  const currentEntries = useMemo(
    () => entries.filter((entry) => parentPath(entry.path) === currentPath),
    [currentPath, entries],
  );
  const visible = useMemo(
    () =>
      currentEntries.filter(
        (entry) =>
          !query || entry.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [currentEntries, query],
  );
  const setEncryptionOverride = (path: string, keyIndex: number | null) => {
    setPackingAssignments((current) => [
      ...current.filter((assignment) => assignment.path !== path),
      { path, keyIndex },
    ]);
    setDirty(true);
  };
  const clearEncryptionOverride = (path: string) => {
    setPackingAssignments((current) =>
      current.filter((assignment) => assignment.path !== path),
    );
    setDirty(true);
  };
  const setCompressionOverride = (path: string, enabled: boolean | null) => {
    setCompressionAssignments((current) => [
      ...current.filter((assignment) => assignment.path !== path),
      ...(enabled === null ? [] : [{ path, enabled }]),
    ]);
    setDirty(true);
  };

  const deleteEntry = (entry: FsEntry) => {
    setEntries((current) =>
      current.filter(
        (item) =>
          item.path !== entry.path && !item.path.startsWith(`${entry.path}/`),
      ),
    );
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const item of entries) {
        if (item.path === entry.path || item.path.startsWith(`${entry.path}/`))
          next.delete(item.id);
      }
      return next;
    });
    setPackingAssignments((current) =>
      current.filter(
        (item) =>
          item.path !== entry.path && !item.path.startsWith(`${entry.path}/`),
      ),
    );
    setCompressionAssignments((current) =>
      current.filter(
        (item) =>
          item.path !== entry.path && !item.path.startsWith(`${entry.path}/`),
      ),
    );
    setDirty(true);
    setNotice({ key: "deleted", vars: { name: entry.name } });
  };

  const withDiscardConfirmation = (action: () => void) => {
    if (!dirty) {
      action();
      return;
    }
    discardActionRef.current = action;
    setConfirmOpen(true);
  };

  const addFiles = async (files: FileList | File[]) => {
    const incoming = Array.from(files).map((file) => ({
      id: `${file.name}-${file.lastModified}-${Math.random()}`,
      name: file.name,
      path: [
        currentPath,
        (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
          file.name,
      ]
        .filter(Boolean)
        .join("/"),
      kind: "file" as const,
      source: { kind: "file" as const, file },
    }));
    if (!incoming.length) return;
    setEntries((old) =>
      withInferredFolders([
        ...old.filter(
          (entry) => !incoming.some((item) => item.path === entry.path),
        ),
        ...incoming,
      ]),
    );
    setSelected(incoming[0].id);
    setSelectedIds(new Set());
    setDirty(true);
    setNotice({ key: "filesAdded", vars: { count: incoming.length } });
  };

  const download = async (
    target: FsEntry | undefined,
    targetFormat: ArchiveFormat = format,
    exportWholeWorkspace = false,
  ) => {
    try {
      const activeCodec =
        codecState.status === "ready" ? codecState.codec : null;
      const codec = activeCodec;
      const selectedPaths = target
        ? [target.path]
        : entries
            .filter((entry) => selectedIds.has(entry.id))
            .map((entry) => entry.path);
      const wholeWorkspace = exportWholeWorkspace;
      const scopePaths = selectedPaths.length
        ? selectedPaths
        : currentPath
          ? [currentPath]
          : [];
      const baseName = downloadBaseName(
        wholeWorkspace
          ? archiveName || "untitled"
          : (target?.name ??
              (currentPath
                ? entryName(currentPath)
                : archiveName || "untitled")),
      );
      const extension = extensionFor(targetFormat);
      const saveHandle = await chooseSaveFile(`${baseName}.${extension}`);
      setBusy(true);
      let workingEntries = entries;
      if (
        codec?.reveal &&
        workingEntries.some((entry) => entry.source?.kind === "mkar")
      ) {
        const revealTargets = wholeWorkspace
          ? [undefined]
          : scopePaths
              .map((path) =>
                workingEntries.find((entry) => entry.path === path),
              )
              .filter((entry): entry is FsEntry => Boolean(entry));
        for (const revealTarget of revealTargets) {
          const revealed = await codec.reveal(
            revealTarget,
            true,
            requestPassword,
          );
          const localEntries = workingEntries.filter(
            (entry) => entry.source?.kind !== "mkar",
          );
          const localPaths = new Set(localEntries.map((entry) => entry.path));
          workingEntries = [
            ...revealed.filter((entry) => !localPaths.has(entry.path)),
            ...localEntries,
          ];
        }
        setEntries(workingEntries);
      }
      const chosenEntries = wholeWorkspace
        ? workingEntries
        : workingEntries.filter((entry) =>
            scopePaths.some(
              (path) =>
                entry.path === path || entry.path.startsWith(`${path}/`),
            ),
          );
      const exportRoot = wholeWorkspace
        ? ""
        : target?.kind === "folder"
          ? target.path
          : currentPath;
      const scopedEntries =
        target?.kind === "folder"
          ? chosenEntries.filter((entry) => entry.path !== target.path)
          : chosenEntries;
      const exportEntries = scopedEntries.map((entry) =>
        rebaseEntry(entry, exportRoot),
      );
      const mkarOptions: MkarEncodeOptions = {};
      if (compressFiles || compressionAssignments.length) {
        mkarOptions.compress = compressFiles;
        mkarOptions.compressionAssignments = rebaseAssignments(
          compressionAssignments,
          exportRoot,
          scopePaths,
          scopedEntries.map((entry) => entry.path),
        );
      }
      if (
        encryptionEnabled ||
        packingKeys.length ||
        packingAssignments.length ||
        encryptDirectories
      ) {
        mkarOptions.encryption = {
          enabled: encryptionEnabled,
          defaultKeyIndex: defaultPackingKeyIndex ?? undefined,
          keys: packingKeys,
          assignments: rebaseAssignments(
            packingAssignments,
            exportRoot,
            scopePaths,
            scopedEntries.map((entry) => entry.path),
          ),
          encryptDirectories,
        };
      }
      if (
        targetFormat === "mkar" &&
        codec?.encodeTo &&
        (await saveProgressiveMkar(
          `${baseName}.mkar`,
          exportEntries,
          codec,
          mkarOptions,
          requestPassword,
          (completed, total) =>
            setNotice({ key: "exportingEntries", vars: { completed, total } }),
          saveHandle,
        ))
      ) {
        if (wholeWorkspace) setDirty(false);
        setNotice({
          key: "exportedAs",
          vars: { name: baseName, format: targetFormat },
        });
        return;
      }
      const encodeEntries = await Promise.all(
        exportEntries.map(async (entry) => {
          if (entry.kind === "folder" || entry.content) return entry;
          if (entry.source?.kind === "file") {
            return {
              ...entry,
              content: new Uint8Array(await entry.source.file.arrayBuffer()),
            };
          }
          if (entry.source?.kind === "mkar" && activeCodec?.read) {
            return {
              ...entry,
              content: await activeCodec.read(entry, requestPassword),
            };
          }
          throw new Error(t("couldNotRead", { path: entry.path }));
        }),
      );
      const tarFormats = new Set<ArchiveFormat>([
        "tar",
        "tar.gz",
        "tar.bz2",
        "tar.xz",
        "tar.zst",
        "tar.lz4",
        "tar.lzma",
        "tar.lz",
        "tar.br",
      ]);
      const encodeOptions = tarFormats.has(targetFormat)
        ? { ...mkarOptions, tarVariant }
        : mkarOptions;
      const bytes = await encodeArchive(
        targetFormat,
        encodeEntries,
        codec,
        encodeOptions,
      );
      const blob = new Blob([toArrayBuffer(bytes)], {
        type:
          targetFormat === "zip"
            ? "application/zip"
            : "application/octet-stream",
      });
      await saveBlob(`${baseName}.${extension}`, blob, saveHandle);
      if (wholeWorkspace && targetFormat === "mkar") setDirty(false);
      setNotice({
        key: "exportedAs",
        vars: { name: baseName, format: targetFormat },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (
        error instanceof MkarError &&
        error.message === "Password entry cancelled"
      ) {
        setNotice({ key: "exportCancelled" });
        return;
      }
      setNotice(codecErrorNotice(error));
    } finally {
      setBusy(false);
    }
  };

  const downloadFile = async (entry: FsEntry) => {
    if (entry.kind !== "file") return;
    try {
      const mimeType =
        entry.source?.kind === "file" && entry.source.file.type
          ? entry.source.file.type
          : "application/octet-stream";
      const saveHandle = await chooseSaveFile(entry.name);
      setBusy(true);
      let bytes: Uint8Array;
      if (entry.content) {
        bytes = entry.content;
      } else if (entry.source?.kind === "file") {
        bytes = new Uint8Array(await entry.source.file.arrayBuffer());
      } else if (
        entry.source?.kind === "mkar" &&
        codecState.status === "ready" &&
        codecState.codec.read
      ) {
        bytes = await codecState.codec.read(entry, requestPassword);
      } else {
        throw new Error(t("couldNotRead", { path: entry.path }));
      }
      await saveBlob(
        entry.name,
        new Blob([toArrayBuffer(bytes)], { type: mimeType }),
        saveHandle,
      );
      setNotice({ key: "downloaded", vars: { name: entry.name } });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (
        error instanceof MkarError &&
        error.message === "Password entry cancelled"
      ) {
        setNotice({ key: "exportCancelled" });
        return;
      }
      setNotice(codecErrorNotice(error));
    } finally {
      setBusy(false);
    }
  };

  const importMkar = async (file?: File) => {
    if (!file || codecState.status !== "ready") return;
    try {
      setBusy(true);
      setNotice({ key: "readingIndex" });
      const imported = codecState.codec.open
        ? await codecState.codec.open(file, undefined, ({ completed, total }) =>
            setNotice({ key: "readingEntry", vars: { completed, total } }),
          )
        : await codecState.codec.decode(
            new Uint8Array(await file.arrayBuffer()),
          );
      setEntries(imported);
      setSelected(imported[0]?.id ?? null);
      setSelectedIds(new Set());
      setCurrentPath("");
      setQuery("");
      setPackingKeys([]);
      setPackingAssignments([]);
      setCompressionAssignments([]);
      setEncryptionEnabled(false);
      setDefaultPackingKeyIndex(null);
      setCompressFiles(false);
      setEncryptDirectories(false);
      setTarVariant("gnu");
      setArchiveName(importedArchiveName(file.name));
      setDirty(false);
      setNotice({ key: "entriesImported", vars: { count: imported.length } });
    } catch (error) {
      setNotice(codecErrorNotice(error));
    } finally {
      setBusy(false);
    }
  };

  const openMkar = () => {
    if (codecState.status !== "ready") return;
    withDiscardConfirmation(() => archiveRef.current?.click());
  };

  const clearWorkspace = () => {
    withDiscardConfirmation(() => {
      if (codecState.status === "ready") codecState.codec.close?.();
      setEntries([]);
      setSelected(null);
      setSelectedIds(new Set());
      setCurrentPath("");
      setQuery("");
      setArchiveName("");
      setPackingKeys([]);
      setPackingAssignments([]);
      setCompressionAssignments([]);
      setEncryptionEnabled(false);
      setDefaultPackingKeyIndex(null);
      setCompressFiles(false);
      setEncryptDirectories(false);
      setTarVariant("gnu");
      setDirty(false);
      setNotice({ key: "workspaceCleared" });
    });
  };

  const openFolder = async (entry: FsEntry) => {
    if (entry.kind !== "folder") return;
    try {
      if (
        entry.source?.kind === "mkar" &&
        codecState.status === "ready" &&
        codecState.codec.reveal
      ) {
        setBusy(true);
        setNotice({
          key: entry.locked ? "unlocking" : "opening",
          vars: { name: entry.name },
        });
        const revealed = await codecState.codec.reveal(
          entry,
          false,
          requestPassword,
        );
        const localEntries = entries.filter(
          (item) => item.source?.kind !== "mkar",
        );
        const localPaths = new Set(localEntries.map((item) => item.path));
        setEntries([
          ...revealed.filter((item) => !localPaths.has(item.path)),
          ...localEntries,
        ]);
      }
      setCurrentPath(entry.path);
      setSelected(null);
      setSelectedIds(new Set());
      setQuery("");
      setNotice({ key: "opened", vars: { name: entry.name } });
    } catch (error) {
      if (
        !(error instanceof MkarError) ||
        error.message !== "Password entry cancelled"
      ) {
        setNotice(codecErrorNotice(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => {
    setCurrentPath(parentPath(currentPath));
    setSelected(null);
    setSelectedIds(new Set());
    setQuery("");
  };

  const renderEntry = (entry: FsEntry): JSX.Element => {
    const isFolder = entry.kind === "folder";
    const isChecked = selectedIds.has(entry.id);
    const displayName = isFolder ? entry.name + "/" : entry.name;
    const mode = entry.source?.kind === "mkar" ? mkarMode(entry) || "—" : "N/A";
    const fsid = entry.source?.kind === "mkar" ? mkarFsid(entry) : "N/A";
    const packingAssignment = packingAssignments
      .filter(
        (item) =>
          entry.path === item.path || entry.path.startsWith(`${item.path}/`),
      )
      .sort((left, right) => left.path.length - right.path.length)
      .at(-1);
    const compressionAssignment = compressionAssignments
      .filter(
        (item) =>
          entry.path === item.path || entry.path.startsWith(`${item.path}/`),
      )
      .sort((left, right) => left.path.length - right.path.length)
      .at(-1);
    const encryptionPolicy = packingAssignment
      ? encryptionEnabled && packingAssignment.keyIndex !== null
      : encryptionEnabled && defaultPackingKeyIndex !== null
        ? true
        : null;
    const compressionPolicy = compressionAssignment
      ? compressionAssignment.enabled
      : compressFiles
        ? true
        : null;
    return (
      <div
        key={entry.id}
        className={`row ${selected === entry.id ? "selected" : ""}`}
        onClick={() => {
          if (isFolder) void openFolder(entry);
          else setSelected(entry.id);
        }}
      >
        <input
          className="entry-check"
          type="checkbox"
          aria-label={t("selectEntry", { name: displayName })}
          checked={isChecked}
          onChange={(event) => {
            event.stopPropagation();
            setSelectedIds((old) => {
              const next = new Set(old);
              event.target.checked ? next.add(entry.id) : next.delete(entry.id);
              return next;
            });
          }}
          onClick={(event) => event.stopPropagation()}
        />
        <span className={`name-cell ${isFolder ? "folder-name" : ""}`}>
          {iconFor(entry)}
          {isFolder ? (
            <button
              className="entry-name-button"
              onClick={(event) => {
                event.stopPropagation();
                void openFolder(entry);
              }}
            >
              {displayName}
            </button>
          ) : (
            <span>{displayName}</span>
          )}
          {entry.encrypted && (
            <span
              className="input-encryption-icon"
              aria-label={t("encrypted")}
              title={t("encrypted")}
            >
              <LockKeyhole size={13} />
            </span>
          )}
        </span>
        <span className="policy-cell">
          {encryptionPolicy === null && compressionPolicy === null && "—"}
          {encryptionPolicy === false ? (
            <span
              className="policy-icon policy-off"
              aria-label={t("encryptionOff")}
              title={t("encryptionOff")}
            >
              <ShieldOff size={15} />
            </span>
          ) : encryptionPolicy === true ? (
            <span
              className="policy-icon policy-on"
              aria-label={t("encryptionOn")}
              title={t("encryptionOn")}
            >
              <ShieldCheck size={15} />
            </span>
          ) : null}
          {compressionPolicy === false ? (
            <span
              className="policy-icon policy-off"
              aria-label={t("compressionOff")}
              title={t("compressionOff")}
            >
              <FileArchive size={15} />
            </span>
          ) : compressionPolicy === true ? (
            <span
              className="policy-icon policy-on"
              aria-label={t("compressionOn")}
              title={t("compressionOn")}
            >
              <FileArchive size={15} />
            </span>
          ) : null}
        </span>
        <span className="mode-cell">{mode}</span>
        <span className="fsid-cell">{fsid}</span>
        <div className="row-actions">
          <button
            className="row-action-button"
            aria-label={t("downloadEntry", { name: displayName })}
            title={t("download")}
            disabled={
              busy ||
              (isFolder && codecState.status !== "ready") ||
              (entry.source?.kind === "mkar" && codecState.status !== "ready")
            }
            onClick={(event) => {
              event.stopPropagation();
              if (isFolder) void download(entry, format);
              else void downloadFile(entry);
            }}
          >
            <Download size={15} /> {t("download")}
          </button>
          <button
            className="row-action-button"
            aria-label={t("entrySettingsFor", { name: displayName })}
            title={t("entrySettings")}
            onClick={(event) => {
              event.stopPropagation();
              setEntrySettingsOpen(entry);
            }}
          >
            <Settings2 size={15} /> {t("settingsLabel")}
          </button>
          <button
            className="row-action-button row-delete-button"
            title={t("deleteLabel")}
            aria-label={t("deleteEntry", { name: displayName })}
            onClick={(event) => {
              event.stopPropagation();
              deleteEntry(entry);
            }}
          >
            <Trash2 size={15} /> {t("deleteLabel")}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div
      className="app-shell"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void addFiles(event.dataTransfer.files);
      }}
    >
      <header ref={topbarRef} className={`topbar${topbarCompact ? " topbar-compact" : ""}`}>
        <div className="brand">
          <Archive size={19} />
          <h1>MKAR</h1>
        </div>
        <div className="topbar-actions">
          <button className="about-button" onClick={() => setAboutOpen(true)}>
            {t("about")}
          </button>
          <label className="language-picker">
            <span>{t("language")}</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as Language)}
              aria-label={t("language")}
            >
              {languageOptions.map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <main className="viewer">
        <section className="viewer-head">
          <label className="archive-name-field">
            <span>{t("archiveName")}</span>
            <input
              value={archiveName}
              placeholder="untitled"
              onChange={(event) => {
                setArchiveName(event.target.value);
                setDirty(true);
              }}
              aria-label={t("archiveNameLabel")}
            />
          </label>
          <div className="archive-head-actions">
            {entries.length > 0 && (
              <span className="archive-meta">
                {dirty && (
                  <span
                    className="dirty-dot"
                    role="img"
                    aria-label={t("unsaved")}
                    title={t("unsaved")}
                  />
                )}
                {currentEntries.length}{" "}
                {currentEntries.length === 1 ? t("item") : t("items")}
              </span>
            )}
            <button
              className="button button-primary"
              onClick={() => void download(undefined, "mkar", true)}
              disabled={
                busy || !entries.length || codecState.status !== "ready"
              }
            >
              <Download size={17} /> {t("export")}
            </button>
          </div>
        </section>

        <div
          ref={toolbarRef}
          className={`toolbar${toolbarCompact ? " toolbar-compact" : ""}${toolbarStacked ? " toolbar-stacked" : ""}`}
          role="toolbar"
          aria-label={t("archiveActions")}
        >
          <div className="command-group">
            <button
              className="button button-primary"
              onClick={openMkar}
              disabled={codecState.status !== "ready" || busy}
              title={t("open")}
            >
              <FileArchive size={17} />
              <span className="button-label">{t("open")}</span>
            </button>
            <button
              className="button button-secondary"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              title={t("add")}
            >
              <Plus size={17} />
              <span className="button-label">{t("add")}</span>
            </button>
            <button
              className="button button-danger"
              onClick={clearWorkspace}
              disabled={(!entries.length && !dirty) || busy}
              title={t("clear")}
            >
              <Trash2 size={17} />
              <span className="button-label">{t("clear")}</span>
            </button>
            <button
              className="button button-secondary encryption-button"
              onClick={() => setEncryptionOpen(true)}
              disabled={busy}
              title={t("settings")}
            >
              <Settings2 size={16} />
              <span className="button-label">{t("settings")}</span>
              {packingAssignments.length > 0 && (
                <span className="count-badge">{packingAssignments.length}</span>
              )}
            </button>
          </div>
          <div className="export-group">
            <label className="format-picker">
              <span>{t("format")}</span>
              <select
                aria-label={t("exportFormat")}
                value={format}
                onChange={(event) =>
                  setFormat(event.target.value as ArchiveFormat)
                }
              >
                {FORMAT_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    .{item}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-primary export-button"
              onClick={() => void download(undefined, format)}
              disabled={
                busy || !selectedIds.size || codecState.status !== "ready"
              }
              title={t("exportSelection")}
            >
              <Download size={17} />
              <span className="button-label">{t("exportSelection")}</span>
            </button>
          </div>
        </div>

        {entries.length > 0 && (
          <div className="location-row">
            <div className="location">
              {currentPath && (
                <button
                  className="button button-secondary back-button"
                  onClick={goBack}
                  disabled={busy}
                  aria-label={t("back")}
                  title={t("backParent")}
                >
                  <ArrowLeft size={16} /> {t("back")}
                </button>
              )}
              <span className="current-path" title={currentPath || "/"}>
                /{currentPath}
              </span>
            </div>
            <label className="search">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("search")}
                aria-label={t("search")}
              />
              {query && (
                <button className="clear" onClick={() => setQuery("")}>
                  <X size={14} />
                </button>
              )}
            </label>
          </div>
        )}

        {!entries.length ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Archive size={25} />
            </div>
            <h3>{t("noArchive")}</h3>
            <p>{t("drop")}</p>
          </div>
        ) : (
          <div ref={tableRef} className={`table-wrap${tableActionsStacked ? " table-actions-stacked" : ""}${tableDetailsStacked ? " table-details-stacked" : ""}`}>
            <div className="table-head">
              <input
                className="entry-check"
                type="checkbox"
                aria-label={t("selectAll")}
                checked={
                  visible.length > 0 &&
                  visible.every((entry) => selectedIds.has(entry.id))
                }
                onChange={(event) => {
                  setSelectedIds((old) => {
                    const next = new Set(old);
                    for (const entry of visible) {
                      if (event.target.checked) next.add(entry.id);
                      else next.delete(entry.id);
                    }
                    return next;
                  });
                }}
              />
              <span>{t("name")}</span>
              <span>C/E</span>
              <span>{t("mode")}</span>
              <span>FSID</span>
              <span />
            </div>
            {visible.map((entry) => renderEntry(entry))}
            {visible.length === 0 && (
              <div className="empty-results">
                {query ? <Search size={20} /> : <Folder size={20} />}
                {query ? t("noMatchingFiles") : t("folderEmpty")}
              </div>
            )}
          </div>
        )}

        <footer className="statusbar">
          <span className={`status-dot ${codecState.status}`} />
          <span>{noticeText}</span>
          <span className="status-right">
            {codecState.status === "ready"
              ? t("ready")
              : codecState.status === "loading"
                ? t("loading")
                : t("unavailable")}
          </span>
        </footer>

        <input
          ref={inputRef}
          hidden
          type="file"
          multiple
          aria-label={t("addFiles")}
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <input
          ref={archiveRef}
          hidden
          type="file"
          accept=".mkar"
          aria-label={t("importMkar")}
          disabled={codecState.status !== "ready"}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importMkar(file);
          }}
        />
      </main>
      {confirmOpen && (
        <ConfirmDialog
          message={t("confirmDiscard")}
          onCancel={() => {
            discardActionRef.current = null;
            setConfirmOpen(false);
          }}
          onConfirm={() => {
            const action = discardActionRef.current;
            discardActionRef.current = null;
            setConfirmOpen(false);
            action?.();
          }}
        />
      )}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {passwordDialog && (
        <PasswordDialog
          key={`${passwordDialog.keyIndex}-${passwordDialog.incorrect}`}
          keyIndex={passwordDialog.keyIndex}
          incorrect={passwordDialog.incorrect}
          onCancel={() => {
            passwordDialog.resolve(null);
            setPasswordDialog(null);
          }}
          onSubmit={(password) => {
            passwordDialog.resolve(password);
            setPasswordDialog(null);
          }}
        />
      )}
      {entrySettingsOpen && (
        <EntrySettingsDialog
          entryName={entrySettingsOpen.name}
          encryption={
            packingAssignments.some(
              (item) => item.path === entrySettingsOpen.path,
            )
              ? packingAssignments.find(
                  (item) => item.path === entrySettingsOpen.path,
                )?.keyIndex === null
                ? "off"
                : "key"
              : "inherit"
          }
          initialKeyIndex={
            packingAssignments.find(
              (item) => item.path === entrySettingsOpen.path,
            )?.keyIndex ?? null
          }
          compression={
            compressionAssignments.some(
              (item) => item.path === entrySettingsOpen.path,
            )
              ? compressionAssignments.find(
                  (item) => item.path === entrySettingsOpen.path,
                )?.enabled
                ? "on"
                : "off"
              : "inherit"
          }
          keys={packingKeys}
          onCancel={() => setEntrySettingsOpen(null)}
          onSave={(encryption, keyIndex, compression) => {
            if (encryption === "inherit")
              clearEncryptionOverride(entrySettingsOpen.path);
            else
              setEncryptionOverride(
                entrySettingsOpen.path,
                encryption === "key" ? keyIndex : null,
              );
            setCompressionOverride(
              entrySettingsOpen.path,
              compression === "inherit" ? null : compression === "on",
            );
            setEntrySettingsOpen(null);
          }}
        />
      )}
      {encryptionOpen && (
        <EncryptionDialog
          initialKeys={packingKeys}
          initialEnabled={encryptionEnabled}
          initialDefaultKeyIndex={defaultPackingKeyIndex}
          initialEncryptDirectories={encryptDirectories}
          initialCompress={compressFiles}
          initialTarVariant={tarVariant}
          onCancel={() => setEncryptionOpen(false)}
          onSave={(
            keys,
            enabled,
            defaultKeyIndex,
            encryptDirectoryListings,
            compress,
            nextTarVariant,
          ) => {
            setPackingKeys(keys);
            setEncryptionEnabled(enabled);
            setDefaultPackingKeyIndex(defaultKeyIndex);
            setEncryptDirectories(encryptDirectoryListings);
            setCompressFiles(compress);
            setTarVariant(nextTarVariant);
            setEncryptionOpen(false);
            setDirty(true);
            setNotice({ key: "settingsUpdated" });
          }}
        />
      )}
    </div>
  );
}
