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
 * @param {Number} frame.streamId -
 * @param {String} [frame.metadata=null] The metadata.
 * @param {String} [frame.data=null] The setup error data.
 * @param {string} [frame.flag=FLAGS.NONE] - Set flags such as complete and
 * follows here.
 * @returns {Buffer} The encoded frame.
 */
function getResponseFrame(frame) {
    assert.object(frame, 'frame');
    assert.number(frame.streamId, 'frame.streamId');
    assert.string(frame.metadataEncoding, 'frame.metadataEncoding');
    assert.string(frame.dataEncoding, 'frame.dataEncoding');
    assert.optionalNumber(frame.flags, 'frame.flags');
    assert.optionalString(frame.metadata, 'frame.metadata');
    assert.optionalString(frame.data, 'frame.data');

    LOG.debug({frame: frame}, 'getResponseFrame: entering');

    var flags = frame.metadata ? FLAGS.METADATA : FLAGS.NONE;

    if (frame.flags) {
        flags = flags | frame.flags;
    }

    frame.type = TYPES.RESPONSE;
    frame.flags = flags;
    frame.streamId = frame.streamId;
    frame.length = computeFrameLength(frame);

    var buffer = new Buffer(frame.length);
    var offset = 0;
    offset += writeFrameHeader(frame, buffer, offset);
    writeFrameData(frame, buffer, offset);

    LOG.debug({frame: frame}, 'getResponseFrame: entering');
    return buffer;
}

module.exports = getResponseFrame;
