export type EntryKind = "file" | "folder";

export type EntrySource =
  | { kind: "file"; file: File }
  | {
      kind: "mkar";
      file: File;
      start: number;
      end: number;
      version: number;
      sourceIndex: number;
      prop: number;
    };

export type FsEntry = {
  id: string;
  name: string;
  path: string;
  kind: EntryKind;
  content?: Uint8Array;
  source?: EntrySource;
  encrypted?: boolean;
  locked?: boolean;
};

export type ArchiveFormat =
  | "mkar"
  | "7z"
  | "cab"
  | "lzh"
  | "zip"
  | "xar"
  | "iso"
  | "shar"
  | "tar.Z"
  | "tar.uu"
  | "tar.b64"
  | "tar.xx"
  | "tar.gz"
  | "tar.bz2"
  | "tar.xz"
  | "tar.zst"
  | "tar.lz4"
  | "tar.lzma"
  | "tar.lz"
  | "tar.br"
  | "asar"
  | "tar"
  | "cpio"
  | "ar";
