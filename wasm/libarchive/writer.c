#include <archive.h>
#include <archive_entry.h>
#include <errno.h>
#include <locale.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int archive_write_add_filter_xxencode(struct archive *);
int archive_write_add_filter_shar_compat(struct archive *);

struct writer {
    struct archive *archive;
    unsigned char *data;
    size_t length;
    size_t capacity;
    size_t limit;
    int status;
    int xxencode;
    char error[512];
};

static int remember(struct writer *writer, int status) {
    if (status != ARCHIVE_OK) {
        const char *message = archive_error_string(writer->archive);
        snprintf(writer->error, sizeof(writer->error), "%s", message ? message : "libarchive operation failed");
        writer->status = status;
    }
    return status;
}

static la_ssize_t append_output(struct archive *archive, void *context, const void *data, size_t length) {
    struct writer *writer = context;
    if (length > writer->limit - writer->length) {
        archive_set_error(archive, ENOMEM, "Archive output exceeds configured limit");
        return -1;
    }
    size_t required = writer->length + length;
    if (required > writer->capacity) {
        size_t capacity = writer->capacity ? writer->capacity : 65536;
        while (capacity < required && capacity < writer->limit) {
            capacity = capacity > writer->limit / 2 ? writer->limit : capacity * 2;
        }
        if (capacity > writer->limit) capacity = writer->limit;
        void *replacement = realloc(writer->data, capacity);
        if (!replacement) {
            archive_set_error(archive, ENOMEM, "Could not allocate archive output");
            return -1;
        }
        writer->data = replacement;
        writer->capacity = capacity;
    }
    if (length) memcpy(writer->data + writer->length, data, length);
    writer->length = required;
    return (la_ssize_t)length;
}

static int select_filter(struct archive *archive, const char *filter) {
    if (!strcmp(filter, "none")) return ARCHIVE_OK;
    if (!strcmp(filter, "gzip")) return archive_write_add_filter_gzip(archive);
    if (!strcmp(filter, "bzip2")) return archive_write_add_filter_bzip2(archive);
    if (!strcmp(filter, "xz")) return archive_write_add_filter_xz(archive);
    if (!strcmp(filter, "lzma")) return archive_write_add_filter_lzma(archive);
    if (!strcmp(filter, "lzip")) return archive_write_add_filter_lzip(archive);
    if (!strcmp(filter, "lz4")) return archive_write_add_filter_lz4(archive);
    if (!strcmp(filter, "zstd")) return archive_write_add_filter_zstd(archive);
    if (!strcmp(filter, "compress")) return archive_write_add_filter_compress(archive);
    if (!strcmp(filter, "uuencode")) return archive_write_add_filter_uuencode(archive);
    if (!strcmp(filter, "b64encode")) return archive_write_add_filter_b64encode(archive);
    if (!strcmp(filter, "xxencode")) return archive_write_add_filter_xxencode(archive);
    archive_set_error(archive, EINVAL, "Unsupported compression filter");
    return ARCHIVE_FATAL;
}

struct writer *la_create(const char *format, const char *filter, size_t limit) {
    if (!limit || limit > 512 * 1024 * 1024 || !setlocale(LC_ALL, "C.UTF-8")) return NULL;
    struct writer *writer = calloc(1, sizeof(*writer));
    if (!writer) return NULL;
    writer->limit = limit;
    writer->archive = archive_write_new();
    if (!writer->archive) { free(writer); return NULL; }
    if (remember(writer, archive_write_set_bytes_in_last_block(writer->archive, 1)) != ARCHIVE_OK) return writer;
    if (!strcmp(format, "shar")) {
        if (remember(writer, archive_write_set_format_shar_dump(writer->archive)) != ARCHIVE_OK) return writer;
    } else if (remember(writer, archive_write_set_format_by_name(writer->archive, format)) != ARCHIVE_OK) return writer;
    if (remember(writer, select_filter(writer->archive, filter)) != ARCHIVE_OK) return writer;
    if (!strcmp(format, "shar") && remember(writer, archive_write_add_filter_shar_compat(writer->archive)) != ARCHIVE_OK) return writer;
    if (!strcmp(format, "zip") && remember(writer, archive_write_set_options(writer->archive, "zip:compression=deflate")) != ARCHIVE_OK) return writer;
    remember(writer, archive_write_open(writer->archive, writer, NULL, append_output, NULL));
    return writer;
}

int la_add(struct writer *writer, const char *path, int directory, const void *data, size_t length) {
    if (writer->status != ARCHIVE_OK) return writer->status;
    struct archive_entry *entry = archive_entry_new();
    if (!entry) {
        archive_set_error(writer->archive, ENOMEM, "Could not allocate archive entry");
        return remember(writer, ARCHIVE_FATAL);
    }
    archive_entry_set_pathname_utf8(entry, path);
    archive_entry_set_filetype(entry, directory ? AE_IFDIR : AE_IFREG);
    archive_entry_set_perm(entry, directory ? 0755 : 0644);
    archive_entry_set_uid(entry, 0);
    archive_entry_set_gid(entry, 0);
    archive_entry_set_mtime(entry, 0, 0);
    archive_entry_set_size(entry, directory ? 0 : (la_int64_t)length);
    int status = remember(writer, archive_write_header(writer->archive, entry));
    if (status == ARCHIVE_OK && !directory && length) {
        la_ssize_t written = archive_write_data(writer->archive, data, length);
        if (written < 0 || (size_t)written != length) {
            if (written >= 0) archive_set_error(writer->archive, EIO, "Incomplete archive entry write");
            status = remember(writer, ARCHIVE_FATAL);
        }
    }
    archive_entry_free(entry);
    return status;
}

int la_finish(struct writer *writer) {
    if (writer->status != ARCHIVE_OK) return writer->status;
    int status = remember(writer, archive_write_close(writer->archive));
    return status;
}

const char *la_error(struct writer *writer) { return writer->error; }
const unsigned char *la_data(struct writer *writer) { return writer->data; }
size_t la_size(struct writer *writer) { return writer->length; }

void la_free(struct writer *writer) {
    if (!writer) return;
    archive_write_free(writer->archive);
    free(writer->data);
    free(writer);
}
