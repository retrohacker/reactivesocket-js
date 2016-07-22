'use strict';

var assert = require('assert-plus');

var getFrameHeader = require('./getFrameHeader');

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

    var flags = FLAGS.NONE;

    if (frame.response) {
        flags = flags | FLAGS.KEEPALIVE_RESPONSE;
    }

    var frameHeaderBuf = getFrameHeader({
        length: frame.data.length,
        type: TYPES.KEEPALIVE,
        flags: flags,
        streamId: 0
    });

    var dataBuffer = new Buffer(frame.data, frame.dataEncoding);

    var buf = Buffer.concat([frameHeaderBuf, dataBuffer]);
    LOG.debug({buffer: buf}, 'getKeepaliveFrame: exiting');
    return buf;
};
