'use strict';

var assert = require('assert-plus');

var getFrameHeader = require('./getFrameHeader');

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

    var flags = FLAGS.NONE;
    var mdLength = 0;

    var metadataBuffer = new Buffer(0);
    if (frame.metadata) {
        flags = flags | FLAGS.METADATA;
        mdLength = frame.metadata.length;
        metadataBuffer = new Buffer(frame.metadata, frame.metadataEncoding);
    }

    var frameHeaderBuf = getFrameHeader({
        length: mdLength,
        type: TYPES.CANCEL,
        flags: flags,
        streamId: frame.streamId
    });

    var buf = Buffer.concat([frameHeaderBuf, metadataBuffer]);
    LOG.debug({buffer: buf}, 'getCancelFrame: exiting');
    return buf;
};
