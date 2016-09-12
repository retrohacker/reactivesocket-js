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
 * @param {Number} frame.ttl Lease Time-To-Leave.
 * @param {Number} frame.budget Number of requests granted.
 * @param {String} [frame.metadata=null] The metadata.
 *
 * @returns {Buffer} The encoded lease frame.
 */
module.exports = function getLeaseFrame(frame) {
    assert.object(frame, 'frame');
    assert.number(frame.ttl, 'frame.ttl');
    assert.number(frame.budget, 'frame.budget');
    assert.optionalString(frame.metadata, 'frame.metadata');
    assert.optionalString(frame.metadataEncoding, 'frame.metadataEncoding');

    LOG.debug({frame: frame}, 'getLeaseFrame: entering');

    frame.type = TYPES.LEASE;
    frame.flags = frame.metadata ? FLAGS.METADATA : FLAGS.NONE;
    frame.streamId = 0;
    frame.length = computeFrameLength(frame);

    var buffer = new Buffer(frame.length);
    var offset = 0;
    offset += writeFrameHeader(frame, buffer, offset);
    buffer.writeUInt32BE(frame.ttl, offset);
    offset += 4;
    buffer.writeUInt32BE(frame.budget, offset);
    offset += 4;
    offset += writeFrameData(frame, buffer, offset);

    LOG.debug({buffer: buffer}, 'getLeaseFrame: exiting');
    return buffer;
};
