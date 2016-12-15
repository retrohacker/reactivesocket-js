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
 * @param {Boolean} frame.response the response flag indicating the receiver
 * must acknowledge.
 * @param {String} [frame.data=null] The optional data associated with the
 * keepalive.
 *
 * @returns {Buffer} The encoded keepalive frame.
 */
module.exports = function getKeepaliveFrame(frame) {
    assert.object(frame, 'frame');
    assert.bool(frame.response, 'frame.response');
    assert.optionalString(frame.data, 'frame.data');
    assert.string(frame.dataEncoding, 'frame.dataEncoding');

    LOG.debug({frame: frame}, 'getKeepaliveFrame: entering');

    frame.type = TYPES.KEEPALIVE;
    frame.flags = frame.response ? FLAGS.KEEPALIVE_RESPONSE : FLAGS.NONE;
    frame.streamId = 0;
    frame.length = computeFrameLength(frame);

    var buffer = new Buffer(frame.length);
    var offset = 0;
    offset += writeFrameHeader(frame, buffer, offset);
    writeFrameData(frame, buffer, offset);

    LOG.debug({buffer: buffer}, 'getKeepaliveFrame: exiting');
    return buffer;
};
