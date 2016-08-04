'use strict';

var _ = require('lodash');
var assert = require('chai').assert;

var getRandomInt = require('../common/getRandomInt');

var SerializeStream = require('../../lib/streams/serializeStream');
var ParseStream = require('../../lib/streams/parseStream.js');

var CONSTANTS = require('../../lib/protocol/constants');
var FLAGS = CONSTANTS.FLAGS;
var TYPES = CONSTANTS.TYPES;
var LOG = require('../common/log');

describe('serialize/parse streams', function () {
    var S_STREAM = new SerializeStream({
        log: LOG,
        metadataEncoding: 'utf-8',
        dataEncoding: 'ascii'
    });
    var P_STREAM = new ParseStream({
        log: LOG,
        metadataEncoding: 'utf-8',
        dataEncoding: 'ascii'
    });
    S_STREAM.pipe(P_STREAM);

    it('setup frame', function (done) {
        var seedFrame = {
            type: TYPES.SETUP,
            flags: FLAGS.LEASE | FLAGS.STRICT,
            keepalive: getRandomInt(0, Math.pow(2, 32)),
            maxLifetime: getRandomInt(0, Math.pow(2, 32)),
            version: CONSTANTS.VERSION,
            metadata: 'We\'re just two lost souls swimming in a fish bowl',
            data: 'year after year'
        };
        P_STREAM.once('data', function (actualFrame) {
            assert.isObject(actualFrame.header);
            assert.equal(actualFrame.header.streamId, 0,
                         'setup frame id must be 0');
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.equal(actualFrame.header.flags,
                         FLAGS.METADATA | seedFrame.flags);
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.SETUP);
            assert.deepEqual(_.omit(actualFrame.setup, 'lease'),
                _.omit(seedFrame, 'data', 'metadata', 'flags', 'type'));
            assert.deepEqual(actualFrame.data, seedFrame.data);
            assert.deepEqual(actualFrame.metadata, seedFrame.metadata);
            done();
        });
        S_STREAM.write(seedFrame);
    });
    it('error frame', function (done) {
        var seedFrame = {
            type: TYPES.ERROR,
            streamId: getRandomInt(0, Math.pow(2, 32)),
            errorCode: getRandomInt(0, Math.pow(2, 16)),
            data: 'Running over the same old ground',
            metadata: 'What have we found'
        };
        P_STREAM.once('data', function (actualFrame) {
            assert.isObject(actualFrame.header);
            assert.equal(actualFrame.header.streamId, seedFrame.streamId);
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.ERROR);
            assert.equal(actualFrame.header.flags, CONSTANTS.FLAGS.METADATA);
            assert.equal(actualFrame.errorCode, seedFrame.errorCode);
            assert.equal(actualFrame.metadata.toString(), seedFrame.metadata);
            assert.equal(actualFrame.data.toString(), seedFrame.data);
            done();
        });
        S_STREAM.write(seedFrame);
    });
    it('request/response frame', function () {
        var seedFrame = {
            type: TYPES.REQUEST_RESPONSE,
            streamId: getRandomInt(0, Math.pow(2, 32)),
            metadata: 'Big Suge in the lolo, bounce and turn',
            data: 'I hit the studio and drop a jewel, hoping it pay'
        };
        P_STREAM.once('data', function (actualFrame) {
            assert.isObject(actualFrame.header);
            assert.equal(actualFrame.header.streamId, seedFrame.streamId);
            assert.equal(actualFrame.header.type,
                         CONSTANTS.TYPES.REQUEST_RESPONSE);
            assert.equal(actualFrame.header.flags, CONSTANTS.FLAGS.METADATA);
            assert.equal(actualFrame.metadata.toString(), seedFrame.metadata);
            assert.equal(actualFrame.data.toString(), seedFrame.data);
        });
        S_STREAM.write(seedFrame);
    });
    it('response frame', function () {
        var seedFrame = {
            type: TYPES.RESPONSE,
            streamId: getRandomInt(0, Math.pow(2, 32)),
            flags: CONSTANTS.FLAGS.COMPLETE,
            metadata: 'I bet you got it twisted you don\'t know who to trust',
            data: 'A five-double-oh - Benz flauntin flashy rings'
        };
        P_STREAM.once('data', function (actualFrame) {
            assert.isObject(actualFrame.header);
            assert.equal(actualFrame.header.streamId, seedFrame.streamId);
            assert.equal(actualFrame.header.type, CONSTANTS.TYPES.RESPONSE);
            assert.equal(actualFrame.header.flags,
                         CONSTANTS.FLAGS.METADATA | CONSTANTS.FLAGS.COMPLETE);
            assert.equal(actualFrame.metadata.toString(), seedFrame.metadata);
            assert.equal(actualFrame.data.toString(), seedFrame.data);
        });
        S_STREAM.write(seedFrame);
    });
});
