'use strict';

var assert = require('assert-plus');

var writeFrameHeader = require('./writeFrameHeader');
var writeFrameData = require('./writeFrameData');
var computeFrameLength = require('./computeFrameLength');

var CONSTANTS = require('./../constants');
var FLAGS = CONSTANTS.FLAGS;
var LOG = require('./../../logger');
var TYPES = CONSTANTS.TYPES;

/**
 * @param {Object} frame -
 * @param {Number} flags -
 * @param {Number} frame.version The version of the protocol.
 * @param {Number} frame.keepalive The keep alive interval in ms.
 * @param {Number} frame.maxLifetime The max life time in ms.
 * @param {Object} frame.metadataEncoding The encoding of the metadata
 * @param {Object} frame.dataEncoding The encoding of the data
 * @param {Object} [frame.data] - Any additional data to send with the setup
 * frame
 * @param {String} [frame.metadata] -
 * @returns {Buffer} The frame.
 */
module.exports = function getSetupFrame(frame) {
    assert.object(frame, 'frame');
    assert.number(frame.version, 'frame.version');
    assert.number(frame.keepalive, 'frame.keepalive');
    assert.number(frame.maxLifetime, 'frame.maxLifetime');
    assert.string(frame.metadataEncoding, 'frame.metadataEncoding');
    assert.string(frame.dataEncoding, 'frame.dataEncoding');
    assert.optionalNumber(frame.flags, 'frame.flags');
    assert.optionalString(frame.metadata, 'frame.metadata');
    assert.optionalString(frame.data, 'frame.data');

    LOG.debug({frame: frame}, 'getSetupFrame: entering');

    var flags = frame.metadata ? FLAGS.METADATA : FLAGS.NONE;

    if (frame.flags) {
        flags = flags | frame.flags;
    }

    frame.type = TYPES.SETUP;
    frame.flags = flags;
    frame.streamId = 0;
    frame.length = computeFrameLength(frame);

    var buffer = new Buffer(frame.length);
    var offset = 0;
    offset += writeFrameHeader(frame, buffer, offset);
    buffer.writeUInt32BE(frame.version, offset);
    offset += 4;
    buffer.writeUInt32BE(frame.keepalive, offset);
    offset += 4;
    buffer.writeUInt32BE(frame.maxLifetime, offset);
    offset += 4;

    // Encoding information
    // 2 bytes for the encoding length + the md and data lengths
    var metaLength = frame.metadataEncoding.length;
    var dataLength = frame.dataEncoding.length;

    // Metadata and encoding type
    buffer.writeUInt8(metaLength, offset);
    offset += 1;
    buffer.write(frame.metadataEncoding, offset, CONSTANTS.MIME_ENCODING);
    offset += metaLength;

    // data and encoding type
    buffer.writeUInt8(dataLength, offset);
    offset += 1;
    buffer.write(frame.dataEncoding, offset, CONSTANTS.MIME_ENCODING);
    offset += dataLength;

    writeFrameData(frame, buffer, offset);

    LOG.debug({buffer: buffer}, 'getSetupFrame: exiting');
    return buffer;
};
