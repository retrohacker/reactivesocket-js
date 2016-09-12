'use strict';

var assert = require('assert-plus');

/**
 * Serialize the `frame` header according to the ReactiveSocket protocol and
 * write this into the `output` buffer at the `offset` location.
 *
 * @param {object} frame - The frame you want to serialize
 * @param {Buffer} output - The output buffer
 * @param {number} offset - The buffer offset at which the data will be copied
 * @returns {number} the number of written bytes
 */
function writeFrameHeader(frame, output, offset) {
    assert.object(frame);
    assert.number(frame.length, 'frame.length');
    assert.number(frame.type, 'frame.type');
    assert.number(frame.flags, 'frame.flags');
    assert.number(frame.streamId, 'frame.streamId');

    offset = output.writeUInt32BE(frame.length, offset);
    offset = output.writeUInt16BE(frame.type, offset);
    offset = output.writeUInt16BE(frame.flags, offset);
    offset = output.writeUInt32BE(frame.streamId, offset);
    return 12;
}

module.exports = writeFrameHeader;
