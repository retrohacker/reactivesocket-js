'use strict';

// All of the constants are defined throughout
// https://github.com/ReactiveSocket/reactivesocket/blob/master/Protocol.md
var CONSTANTS = {

    // Flags are used in the first two LSBs in the second int in the frame
    // header.  They are defined here
    FLAGS: {
        NONE: 0x0000,
        IGNORE: 0x8000,
        METADATA: 0x4000,
        LEASE: 0x2000,
        STRICT: 0x1000,
        FOLLOWS: 0x2000,
        COMPLETE: 0x1000,
        REQUEST_N_PRESENT: 0x0800
    },

    // Frame type.  The first two MSB of the second int of the frame header.
    TYPES: {
        RESERVED: 0x0000,
        SETUP: 0x0001,
        LEASE: 0x0002,
        KEEPALIVE: 0x0003,
        REQUEST_RESPONSE: 0x0004,
        REQUEST_FNF: 0x0005,
        REQUEST_STREAM: 0x0006,
        REQUEST_SUB: 0x0007,
        REQUEST_CHANNEL: 0x0008,
        REQUEST_N: 0x0009,
        CANCEL: 0x000A,
        RESPONSE: 0x000B,
        ERROR: 0x000C,
        METADATA_PUSH: 0x000D,
        NEXT: 0x000E,
        COMPLETE: 0x000F,
        NEXT_COMPLETE: 0x0010,
        EXT: 0xFFFF
    },

    ERROR_CODES: {
        //RESERVED: 0x00000000,
        INVALID_SETUP: 0x0000001,
        UNSUPPORTED_SETUP: 0x00000002,
        REJECTED_SETUP: 0x00000003,
        CONNECTION_ERROR: 0x00000101,
        APPLICATION_ERROR: 0x00000201,
        REJECTED: 0x00000202,
        CANCELED: 0x00000203,
        INVALID: 0x0000204,
        RESERVED: 0xFFFFFFFF
    },

    // Protocol version
    VERSION: 0x0,

    // Maximum allowable stream id
    MAX_STREAM_ID: 0xFFFFFFFF,

    // Restricted to the first 31 LSbs
    FRAME_LENGTH: 0x7FFFFFFF,

    // The length of the header in bytes
    FRAME_HEADER_LENGTH: 12,

    // The length of the metadata length field in the payload spec
    METADATA_LENGTH: 4,

    // encoding for meta and data. https://tools.ietf.org/html/rfc2045#page-14
    MIME_ENCODING: 'ASCII'
};

module.exports = CONSTANTS;
