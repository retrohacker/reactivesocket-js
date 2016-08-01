'use strict';

var assert = require('assert-plus');

var getFrameHeader = require('./getFrameHeader');

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

    var flags = FLAGS.NONE;

    var mdLength = 0;
    var mdBuffer = new Buffer(0);

    if (frame.metadata) {
        flags = flags | FLAGS.METADATA;
        mdLength = frame.metadata.length;
        mdBuffer = new Buffer(frame.metadata, frame.metadataEncoding);
    }

    var frameHeaderBuf = getFrameHeader({
        length: 2 * 4 + mdLength,
        type: TYPES.LEASE,
        flags: flags,
        streamId: 0
    });

    var leaseBuffer = new Buffer( 2 * 4 ).fill(0);
    leaseBuffer.writeUInt32BE(frame.ttl, 0);
    leaseBuffer.writeUInt32BE(frame.budget, 4);

    var buf = Buffer.concat([frameHeaderBuf, leaseBuffer, mdBuffer]);
    LOG.debug({buffer: buf}, 'getLeaseFrame: exiting');
    return buf;
};
