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
 * @param {String} [frame.metadata=null] The optional metadata associated with
 * the cancel frame.
 *
 * @returns {Buffer} The encoded cancel frame.
 */
module.exports = function getCancelFrame(frame) {
    assert.object(frame, 'frame');
    assert.number(frame.streamId, 'frame.streamId');
    assert.optionalString(frame.metadata, 'frame.metadata');
    assert.optionalString(frame.metadataEncoding, 'frame.metadataEncoding');

    LOG.debug({frame: frame}, 'getCancelFrame: entering');

    frame.type = TYPES.CANCEL;
    frame.flags = frame.metadata ? FLAGS.METADATA : FLAGS.NONE;
    frame.streamId = frame.streamId;
    frame.length = computeFrameLength(frame);

    var buffer = new Buffer(frame.length);
    var offset = 0;
    offset += writeFrameHeader(frame, buffer, offset);
    writeFrameData(frame, buffer, offset);

    LOG.debug({buffer: buffer}, 'getCancelFrame: exiting');
    return buffer;
};
