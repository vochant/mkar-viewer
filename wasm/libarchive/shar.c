#include "archive_platform.h"
#include "archive.h"
#include "archive_private.h"
#include "archive_write_private.h"
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

struct shar_compat_state {
    unsigned char *input;
    size_t length;
    size_t capacity;
};

static const char shar_header[] = "# This is a shell archive\n";
static const char decoder_probe[] =
    "if printf 'begin 644 /dev/null\\n`\\nend\\n' | uudecode -p >/dev/null 2>&1; then\n"
    "  shar_uudecode='uudecode -p'\n"
    "else\n"
    "  shar_uudecode='uudecode -o /dev/stdout'\n"
    "fi\n";
static const char decoder_command[] = "uudecode -p > ";
static const char decoder_variable[] = "$shar_uudecode > ";

static int shar_compat_open(struct archive_write_filter *filter) {
    return ARCHIVE_OK;
}

static int shar_compat_flush(struct archive_write_filter *filter) {
    return ARCHIVE_OK;
}

static int shar_compat_write(struct archive_write_filter *filter, const void *buffer, size_t length) {
    struct shar_compat_state *state = filter->data;
    if (length > SIZE_MAX - state->length) {
        archive_set_error(filter->archive, ENOMEM, "SHAR compatibility buffer is too large");
        return ARCHIVE_FATAL;
    }
    size_t required = state->length + length;
    if (required > state->capacity) {
        size_t capacity = state->capacity ? state->capacity : 65536;
        while (capacity < required) {
            if (capacity > SIZE_MAX / 2) {
                capacity = required;
                break;
            }
            capacity *= 2;
        }
        unsigned char *replacement = realloc(state->input, capacity);
        if (!replacement) {
            archive_set_error(filter->archive, ENOMEM, "Could not allocate SHAR compatibility buffer");
            return ARCHIVE_FATAL;
        }
        state->input = replacement;
        state->capacity = capacity;
    }
    memcpy(state->input + state->length, buffer, length);
    state->length = required;
    return ARCHIVE_OK;
}

static int shar_compat_close(struct archive_write_filter *filter) {
    struct shar_compat_state *state = filter->data;
    const size_t header_length = sizeof(shar_header) - 1;
    const size_t probe_length = sizeof(decoder_probe) - 1;
    const size_t command_length = sizeof(decoder_command) - 1;
    const size_t variable_length = sizeof(decoder_variable) - 1;
    const unsigned char *header = NULL;
    size_t matches = 0;

    for (size_t index = 0; index + command_length <= state->length; ++index) {
        if (!memcmp(state->input + index, decoder_command, command_length)) ++matches;
    }
    if (!matches) return __archive_write_filter(filter->next_filter, state->input, state->length);

    for (size_t index = 0; index + header_length <= state->length; ++index) {
        if (!memcmp(state->input + index, shar_header, header_length)) {
            header = state->input + index + header_length;
            break;
        }
    }
    if (!header) {
        archive_set_error(filter->archive, ARCHIVE_ERRNO_MISC, "Could not find SHAR header");
        return ARCHIVE_FATAL;
    }
    const size_t growth = variable_length - command_length;
    if (state->length > SIZE_MAX - probe_length ||
        matches > (SIZE_MAX - state->length - probe_length) / growth) {
        archive_set_error(filter->archive, ENOMEM, "SHAR compatibility output is too large");
        return ARCHIVE_FATAL;
    }
    const size_t output_length = state->length + probe_length + matches * growth;
    unsigned char *output = malloc(output_length);
    if (!output) {
        archive_set_error(filter->archive, ENOMEM, "Could not allocate SHAR compatibility output");
        return ARCHIVE_FATAL;
    }

    const size_t header_offset = (size_t)(header - state->input);
    size_t read = header_offset;
    size_t written = header_offset;
    memcpy(output, state->input, header_offset);
    memcpy(output + written, decoder_probe, probe_length);
    written += probe_length;
    while (read < state->length) {
        if (read + command_length <= state->length &&
            !memcmp(state->input + read, decoder_command, command_length)) {
            memcpy(output + written, decoder_variable, variable_length);
            written += variable_length;
            read += command_length;
        } else {
            output[written++] = state->input[read++];
        }
    }
    int result = __archive_write_filter(filter->next_filter, output, written);
    free(output);
    return result;
}

static int shar_compat_free(struct archive_write_filter *filter) {
    struct shar_compat_state *state = filter->data;
    if (state) {
        free(state->input);
        free(state);
    }
    return ARCHIVE_OK;
}

int archive_write_add_filter_shar_compat(struct archive *archive) {
    struct shar_compat_state *state = calloc(1, sizeof(*state));
    if (!state) {
        archive_set_error(archive, ENOMEM, "Could not allocate SHAR compatibility filter");
        return ARCHIVE_FATAL;
    }
    struct archive_write_filter *filter = __archive_write_allocate_filter(archive);
    if (!filter) {
        free(state);
        return ARCHIVE_FATAL;
    }
    filter->name = "shar compatibility";
    filter->data = state;
    filter->open = shar_compat_open;
    filter->write = shar_compat_write;
    filter->flush = shar_compat_flush;
    filter->close = shar_compat_close;
    filter->free = shar_compat_free;
    return ARCHIVE_OK;
}
