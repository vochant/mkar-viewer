#include "archive_platform.h"
#include "archive.h"
#include "archive_private.h"
#include "archive_write_private.h"
#include <errno.h>
#include <stdlib.h>
#include <string.h>

struct xx_state {
    unsigned char *input;
    size_t length;
    size_t capacity;
};

static int xx_open(struct archive_write_filter *filter) { return ARCHIVE_OK; }
static int xx_flush(struct archive_write_filter *filter) { return ARCHIVE_OK; }
static int xx_write(struct archive_write_filter *filter, const void *buffer, size_t length) {
    struct xx_state *state = filter->data;
    if (length > SIZE_MAX - state->length) return ARCHIVE_FATAL;
    size_t required = state->length + length;
    if (required > state->capacity) {
        size_t capacity = state->capacity ? state->capacity : 65536;
        while (capacity < required) {
            if (capacity > SIZE_MAX / 2) { capacity = required; break; }
            capacity *= 2;
        }
        unsigned char *replacement = realloc(state->input, capacity);
        if (!replacement) {
            archive_set_error(filter->archive, ENOMEM, "Could not allocate xxencode buffer");
            return ARCHIVE_FATAL;
        }
        state->input = replacement;
        state->capacity = capacity;
    }
    memcpy(state->input + state->length, buffer, length);
    state->length = required;
    return ARCHIVE_OK;
}

static int xx_close(struct archive_write_filter *filter) {
    static const char alphabet[] = "+-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    static const char header[] = "begin 644 -\n";
    static const char end[] = "end\n";
    struct xx_state *state = filter->data;
    size_t output_capacity = 12 + ((state->length + 44) / 45) * 62 + 6;
    unsigned char *output = malloc(output_capacity);
    if (!output) {
        archive_set_error(filter->archive, ENOMEM, "Could not allocate xxencode output");
        return ARCHIVE_FATAL;
    }
    size_t offset = 0;
    memcpy(output + offset, header, sizeof(header) - 1); offset += sizeof(header) - 1;
    for (size_t start = 0; start < state->length; start += 45) {
        size_t count = state->length - start;
        if (count > 45) count = 45;
        output[offset++] = alphabet[count];
        for (size_t index = 0; index < count; index += 3) {
            unsigned int value = state->input[start + index] << 16;
            if (index + 1 < count) value |= state->input[start + index + 1] << 8;
            if (index + 2 < count) value |= state->input[start + index + 2];
            output[offset++] = alphabet[(value >> 18) & 63];
            output[offset++] = alphabet[(value >> 12) & 63];
            output[offset++] = alphabet[(value >> 6) & 63];
            output[offset++] = alphabet[value & 63];
        }
        output[offset++] = '\n';
    }
    /* XXencode has no uuencode-style zero-byte run optimization. Its zero
     * length line is encoded with alphabet[0], which is '+'. */
    output[offset++] = alphabet[0]; output[offset++] = '\n';
    memcpy(output + offset, end, sizeof(end) - 1); offset += sizeof(end) - 1;
    int result = __archive_write_filter(filter->next_filter, output, offset);
    free(output);
    return result;
}

static int xx_free(struct archive_write_filter *filter) {
    struct xx_state *state = filter->data;
    if (state) { free(state->input); free(state); }
    return ARCHIVE_OK;
}

int archive_write_add_filter_xxencode(struct archive *archive) {
    struct archive_write_filter *filter;
    struct xx_state *state = calloc(1, sizeof(*state));
    if (!state) { archive_set_error(archive, ENOMEM, "Could not allocate xxencode filter"); return ARCHIVE_FATAL; }
    filter = __archive_write_allocate_filter(archive);
    if (!filter) { free(state); return ARCHIVE_FATAL; }
    filter->name = "xxencode";
    filter->data = state;
    filter->open = xx_open;
    filter->write = xx_write;
    filter->flush = xx_flush;
    filter->close = xx_close;
    filter->free = xx_free;
    return ARCHIVE_OK;
}
