'use strict';

var assert = require('assert-plus');

var METADATA_LENGTH = require('./../constants').METADATA_LENGTH;

/**
 * Serialize the `frame` data according to the ReactiveSocket protocol and
 * write this into the `output` buffer at the `offset` location.
 *
 * @param {object} frame - The frame you want to serialize
 * @param {Buffer} output - The output buffer
 * @param {number} offset - The buffer offset at which the data will be copied
 * @returns {number} the number of written bytes
 */
function writeFrameData(frame, output, offset) {
    assert.object(frame);
    assert.optionalString(frame.metadata, 'frame.metadata');
    assert.optionalString(frame.data, 'frame.data');

    var writtenBytes = 0;

    if (frame.metadata) {
        assert.string(frame.metadataEncoding, 'frame.metadataEncoding');

        var mdLength = Buffer.byteLength(
            frame.metadata, frame.metadataEncoding);
        output.writeUInt32BE(mdLength + METADATA_LENGTH, offset);
        offset += METADATA_LENGTH;
        writtenBytes += METADATA_LENGTH;

        output.write(frame.metadata, offset, frame.metadataEncoding);
        offset += mdLength;
        writtenBytes += mdLength;
    }

    if (frame.data) {
        assert.string(frame.dataEncoding, 'frame.dataEncoding');

        output.write(frame.data, offset, frame.dataEncoding);
        writtenBytes += frame.data.length;
    }

    return writtenBytes;
}

module.exports = writeFrameData;
