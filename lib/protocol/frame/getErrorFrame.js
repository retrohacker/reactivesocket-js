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
 * @param {Object} frame - The frame to be encoded as buffer
 * @param {Number} frame.streamId The stream ID.
 * @param {Number} frame.errorCode The error code.
 * @param {string} [frame.flag=FLAGS.NONE] - Set flags such as complete and
 * //TODO: MD and Data should really be buffers, since we don't encode. As a
 * convenience right now we assume utf8
 * @param {String} [frame.metadata=null] The metadata.
 * @param {String} [frame.data=null] The setup error data.
 *
 * @returns {Buffer} The encoded error frame.
 */
module.exports = function getErrorFrame(frame) {
    assert.object(frame, 'frame');
    assert.number(frame.streamId, 'frame.streamId');
    assert.number(frame.errorCode, 'frame.errorCode');
    assert.string(frame.metadataEncoding, 'frame.metadataEncoding');
    assert.string(frame.dataEncoding, 'frame.dataEncoding');
    assert.optionalNumber(frame.flags, 'frame.flags');
    assert.optionalString(frame.metadata, 'frame.metadata');
    assert.optionalString(frame.data, 'frame.data');

    LOG.debug({frame: frame}, 'getErrorFrame: entering');

    frame.type = TYPES.ERROR;
    frame.flags = frame.metadata ? FLAGS.METADATA : FLAGS.NONE;
    frame.streamId = frame.streamId;
    frame.length = computeFrameLength(frame);

    var buffer = new Buffer(frame.length);
    var offset = 0;
    offset += writeFrameHeader(frame, buffer, offset);
    buffer.writeUInt32BE(frame.errorCode, offset);
    offset += 4;
    offset += writeFrameData(frame, buffer, offset);

    LOG.debug({buffer: buffer}, 'getErrorFrame: exiting');

    return buffer;
};
