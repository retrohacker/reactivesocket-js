'use strict';

var assert = require('assert-plus');

var CONSTANTS = require('./../constants');
var FRAME_HEADER_LENGTH = CONSTANTS.FRAME_HEADER_LENGTH;
var METADATA_LENGTH = require('./../constants').METADATA_LENGTH;
var TYPES = CONSTANTS.TYPES;

/**
 * Compute the size of the encoded frame.
 * @param {Object} frame - The frame to be encoded as buffer
 *
 * @returns {number} The size of the encoded frame.
 */
function computeFrameLength(frame) {
    assert.number(frame.type, 'frame.type');

    var length = FRAME_HEADER_LENGTH;

    switch (frame.type) {
        case TYPES.SETUP:
            length += 12;
            length += 1 + frame.metadataEncoding.length;
            length += 1 + frame.dataEncoding.length;
            break;
        case TYPES.LEASE:
            length += 8;
            break;
        case TYPES.REQUEST_STREAM:
        case TYPES.REQUEST_SUB:
        case TYPES.REQUEST_N:
        case TYPES.ERROR:
            length += 4;
            break;
        case TYPES.REQUEST_CHANNEL:
        case TYPES.REQUEST_FNF:
        case TYPES.CANCEL:
        case TYPES.KEEPALIVE:
        default:
            break;
    }

    if (frame.metadata) {
        length += METADATA_LENGTH;
        length += Buffer.byteLength(frame.metadata, frame.metadataEncoding);
    }

    if (frame.data) {
        length += Buffer.byteLength(frame.data, frame.dataEncoding);
    }

    return length;
}

module.exports = computeFrameLength;
