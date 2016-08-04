'use strict';

var _ = require('lodash');
var assert = require('chai').assert;

var getRandomInt = require('../common/getRandomInt');

var FramingStream = require('../../lib/streams/framingStream');
var ParseStream = require('../../lib/streams/parseStream.js');
var SerializeStream = require('../../lib/streams/serializeStream');

var CONSTANTS = require('../../lib/protocol/constants');
var FLAGS = CONSTANTS.FLAGS;
var TYPES = CONSTANTS.TYPES;

var LOG = require('../common/log');

describe('framing stream', function () {
    var FRAME = {
        type: TYPES.SETUP,
        flags: FLAGS.LEASE | FLAGS.STRICT,
        keepalive: getRandomInt(0, Math.pow(2, 32)),
        maxLifetime: getRandomInt(0, Math.pow(2, 32)),
        version: CONSTANTS.VERSION,
        metadata: 'We\'re just two lost souls swimming in a fish bowl',
        data: 'year after year'
    };

    var F_STREAM;
    var P_STREAM;

    var FRAME_LEN;
    var COMP_FRAME;
    var FIRST_HALF_FRAME;
    var SECOND_HALF_FRAME;

    before(function (done) {
        var ss = new SerializeStream({
            log: LOG,
            metadataEncoding: 'utf-8',
            dataEncoding: 'ascii'
        });
        ss.write(FRAME);
        ss.on('data', function (buf) {
            COMP_FRAME = buf;
            FRAME_LEN = COMP_FRAME.length;
            // apparently second param of slice is length, and not index.
            FIRST_HALF_FRAME = COMP_FRAME.slice(0, FRAME_LEN / 2);
            SECOND_HALF_FRAME = COMP_FRAME.slice(FRAME_LEN / 2);
            done();
        });
    });

    beforeEach(function () {
        F_STREAM = new FramingStream({
            log: LOG
        });
        P_STREAM = new ParseStream({
            log: LOG,
            metadataEncoding: 'utf-8',
            dataEncoding: 'ascii'
        });
        F_STREAM.pipe(P_STREAM);
    });

    it('should frame a complete frame', function (done) {
        P_STREAM.on('data', function (actualFrame) {
            assert.isObject(actualFrame.header);
            assert.equal(actualFrame.header.streamId, 0,
                         'setup frame id must be 0');
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.equal(actualFrame.header.flags,
                         FLAGS.METADATA | FRAME.flags);
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.deepEqual(_.omit(actualFrame.setup, 'lease'),
                _.omit(FRAME, 'data', 'metadata', 'flags', 'type'));
            assert.deepEqual(actualFrame.data, FRAME.data);
            assert.deepEqual(actualFrame.metadata, FRAME.metadata);
            done();
        });

        F_STREAM.write(COMP_FRAME);
    });

    it('should not frame an incomplete stream', function () {
        P_STREAM.on('data', function () {
            assert.fail(null, null, 'incomplete frame should not emit data');
        });
        F_STREAM.write(FIRST_HALF_FRAME);
    });

    it('should frame 2 complete frames', function (done) {
        var count = 0;
        P_STREAM.on('data', function (actualFrame) {
            count++;

            if (count > 2) {
                throw new Error('should only get 2 frames');
            }
            assert.isObject(actualFrame.header);
            assert.equal(actualFrame.header.streamId, 0,
                         'setup frame id must be 0');
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.equal(actualFrame.header.flags,
                         FLAGS.METADATA | FRAME.flags);
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.deepEqual(_.omit(actualFrame.setup, 'lease'),
                _.omit(FRAME, 'data', 'metadata', 'flags', 'type'));
            assert.deepEqual(actualFrame.data, FRAME.data);
            assert.deepEqual(actualFrame.metadata, FRAME.metadata);

            if (count === 2) {
                done();
            }
        });

        F_STREAM.write(Buffer.concat([COMP_FRAME, COMP_FRAME]));
    });

    it('should frame complete and incomplete frame', function (done) {
        var count = 0;
        P_STREAM.on('data', function (actualFrame) {
            count++;

            if (count > 1) {
                throw new Error('should only get one frame');
            }
            assert.isObject(actualFrame.header);
            assert.equal(actualFrame.header.streamId, 0,
                         'setup frame id must be 0');
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.equal(actualFrame.header.flags,
                         FLAGS.METADATA | FRAME.flags);
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.deepEqual(_.omit(actualFrame.setup, 'lease'),
                _.omit(FRAME, 'data', 'metadata', 'flags', 'type'));
            assert.deepEqual(actualFrame.data, FRAME.data);
            assert.deepEqual(actualFrame.metadata, FRAME.metadata);
            done();
        });

        F_STREAM.write(Buffer.concat([COMP_FRAME, FIRST_HALF_FRAME]));
    });

    it('should frame 2 frames from c+i, i', function (done) {
        var count = 0;
        P_STREAM.on('data', function (actualFrame) {
            count++;

            if (count > 2) {
                throw new Error('should only get 2 frames');
            }
            assert.isObject(actualFrame.header);
            assert.equal(actualFrame.header.streamId, 0,
                         'setup frame id must be 0');
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.equal(actualFrame.header.flags,
                         FLAGS.METADATA | FRAME.flags);
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.deepEqual(_.omit(actualFrame.setup, 'lease'),
                _.omit(FRAME, 'data', 'metadata', 'flags', 'type'));
            assert.deepEqual(actualFrame.data, FRAME.data);
            assert.deepEqual(actualFrame.metadata, FRAME.metadata);

            if (count === 2) {
                done();
            }
        });

        F_STREAM.write(Buffer.concat([COMP_FRAME, FIRST_HALF_FRAME]));
        F_STREAM.write(SECOND_HALF_FRAME);
    });

    it('should frame 2 frames from c+i, i, spanning length header',
       function (done) {
        var count = 0;
        P_STREAM.on('data', function (actualFrame) {
            count++;

            if (count > 2) {
                throw new Error('should only get 2 frames');
            }
            assert.isObject(actualFrame.header);
            assert.equal(actualFrame.header.streamId, 0,
                         'setup frame id must be 0');
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.equal(actualFrame.header.flags,
                         FLAGS.METADATA | FRAME.flags);
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.deepEqual(_.omit(actualFrame.setup, 'lease'),
                _.omit(FRAME, 'data', 'metadata', 'flags', 'type'));
            assert.deepEqual(actualFrame.data, FRAME.data);
            assert.deepEqual(actualFrame.metadata, FRAME.metadata);

            if (count === 2) {
                done();
            }
        });
        var first_span = COMP_FRAME.slice(0, 3);
        var second_span = COMP_FRAME.slice(3);

        F_STREAM.write(Buffer.concat([COMP_FRAME, first_span]));
        F_STREAM.write(second_span);
    });

    it('should frame 2 frames from c+i, i, i', function (done) {
        var count = 0;
        P_STREAM.on('data', function (actualFrame) {
            count++;

            if (count > 2) {
                throw new Error('should only get 2 frames');
            }
            assert.isObject(actualFrame.header);
            assert.equal(actualFrame.header.streamId, 0,
                         'setup frame id must be 0');
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.equal(actualFrame.header.flags,
                         FLAGS.METADATA | FRAME.flags);
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.deepEqual(_.omit(actualFrame.setup, 'lease'),
                _.omit(FRAME, 'data', 'metadata', 'flags', 'type'));
            assert.deepEqual(actualFrame.data, FRAME.data);
            assert.deepEqual(actualFrame.metadata, FRAME.metadata);

            if (count === 2) {
                done();
            }
        });

        F_STREAM.write(Buffer.concat([COMP_FRAME, FIRST_HALF_FRAME]));
        F_STREAM.write(SECOND_HALF_FRAME.slice(0,
                                               SECOND_HALF_FRAME.length / 2));
        F_STREAM.write(SECOND_HALF_FRAME.slice(SECOND_HALF_FRAME.length / 2));
    });

    it('should frame 3 frames from c+i, i, i+c', function (done) {
        var count = 0;
        P_STREAM.on('data', function (actualFrame) {
            count++;

            if (count > 3) {
                throw new Error('should only get 3 frames');
            }
            assert.isObject(actualFrame.header);
            assert.equal(actualFrame.header.streamId, 0,
                         'setup frame id must be 0');
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.equal(actualFrame.header.flags,
                         FLAGS.METADATA | FRAME.flags);
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.deepEqual(_.omit(actualFrame.setup, 'lease'),
                _.omit(FRAME, 'data', 'metadata', 'flags', 'type'));
            assert.deepEqual(actualFrame.data, FRAME.data);
            assert.deepEqual(actualFrame.metadata, FRAME.metadata);

            if (count === 3) {
                done();
            }
        });

        F_STREAM.write(Buffer.concat([COMP_FRAME, FIRST_HALF_FRAME]));
        F_STREAM.write(SECOND_HALF_FRAME.slice(0,
                                               SECOND_HALF_FRAME.length / 2));
        F_STREAM.write(Buffer.concat([
            SECOND_HALF_FRAME.slice(SECOND_HALF_FRAME.length / 2),
            COMP_FRAME
        ]));
    });

    it('should frame 4 frames from c+i, i, i+c+i, i', function (done) {
        var count = 0;
        P_STREAM.on('data', function (actualFrame) {
            count++;

            if (count > 4) {
                throw new Error('should only get 4 frames');
            }
            assert.isObject(actualFrame.header);
            assert.equal(actualFrame.header.streamId, 0,
                         'setup frame id must be 0');
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.equal(actualFrame.header.flags,
                         FLAGS.METADATA | FRAME.flags);
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.deepEqual(_.omit(actualFrame.setup, 'lease'),
                _.omit(FRAME, 'data', 'metadata', 'flags', 'type'));
            assert.deepEqual(actualFrame.data, FRAME.data);
            assert.deepEqual(actualFrame.metadata, FRAME.metadata);

            if (count === 4) {
                done();
            }
        });

        // c+i
        F_STREAM.write(Buffer.concat([COMP_FRAME, FIRST_HALF_FRAME]));
        // i
        F_STREAM.write(SECOND_HALF_FRAME.slice(
            0, SECOND_HALF_FRAME.length / 2));
        // i+c+i
        F_STREAM.write(Buffer.concat([
            SECOND_HALF_FRAME.slice(SECOND_HALF_FRAME.length / 2),
            COMP_FRAME,
            FIRST_HALF_FRAME
        ]));

        // i
        F_STREAM.write(SECOND_HALF_FRAME);
    });

    it('should frame 4 frames from c+i, i+c+c', function (done) {
        var count = 0;
        P_STREAM.on('data', function (actualFrame) {
            count++;

            if (count > 4) {
                throw new Error('should only get 4 frames');
            }
            assert.isObject(actualFrame.header);
            assert.equal(actualFrame.header.streamId, 0,
                         'setup frame id must be 0');
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.equal(actualFrame.header.flags,
                         FLAGS.METADATA | FRAME.flags);
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.deepEqual(_.omit(actualFrame.setup, 'lease'),
                _.omit(FRAME, 'data', 'metadata', 'flags', 'type'));
            assert.deepEqual(actualFrame.data, FRAME.data);
            assert.deepEqual(actualFrame.metadata, FRAME.metadata);

            if (count === 4) {
                done();
            }
        });

        F_STREAM.write(Buffer.concat([COMP_FRAME, FIRST_HALF_FRAME]));
        F_STREAM.write(Buffer.concat([
            SECOND_HALF_FRAME,
            COMP_FRAME,
            COMP_FRAME
        ]));
    });

    it('should frame 4 frames from c+i, i+c+c+i', function (done) {
        var count = 0;
        P_STREAM.on('data', function (actualFrame) {
            count++;

            if (count > 4) {
                throw new Error('should only get 4 frames');
            }
            assert.isObject(actualFrame.header);
            assert.equal(actualFrame.header.streamId, 0,
                         'setup frame id must be 0');
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.equal(actualFrame.header.flags,
                         FLAGS.METADATA | FRAME.flags);
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.deepEqual(_.omit(actualFrame.setup, 'lease'),
                _.omit(FRAME, 'data', 'metadata', 'flags', 'type'));
            assert.deepEqual(actualFrame.data, FRAME.data);
            assert.deepEqual(actualFrame.metadata, FRAME.metadata);

            if (count === 4) {
                done();
            }
        });

        F_STREAM.write(Buffer.concat([COMP_FRAME, FIRST_HALF_FRAME]));
        F_STREAM.write(Buffer.concat([
            SECOND_HALF_FRAME,
            COMP_FRAME,
            COMP_FRAME,
            FIRST_HALF_FRAME
        ]));
    });
});
