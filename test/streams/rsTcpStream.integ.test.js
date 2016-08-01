'use strict';

var fs = require('fs');
var net = require('net');

var _ = require('lodash');
var assert = require('chai').assert;
var bunyan = require('bunyan');
var sinon = require('sinon');

var getRandomInt = require('../common/getRandomInt');

var FramingStream = require('../../lib/streams/framingStream');
var ParseStream = require('../../lib/streams/parseStream.js');
var SerializeStream = require('../../lib/streams/serializeStream');

var CONSTANTS = require('../../lib/protocol/constants');
var FLAGS = require('../../lib/protocol/constants').FLAGS;
var TYPES = require('../../lib/protocol/constants').TYPES;
var PORT = process.env.PORT || 1337;
var HOST = process.env.HOST || 'localhost';

var METADATA_ENCODING = 'utf8';
var DATA_ENCODING = 'utf8';

// we need to send a large enough frame to ensure we exceed the default TCP
// loopback MTU of 16384 bytes. This is to test that framing actually works.
// Hence we read in some select works of the Bard.
var HAMLET = fs.readFileSync('./test/etc/hamlet.txt', 'utf8');
var JULIUS_CAESAR = fs.readFileSync('./test/etc/julius_caesar.txt', 'utf8');

describe('RS TCP Integ Tests', function () {
    var LOG = bunyan.createLogger({
        name: 'rs client stream tests',
        level: process.env.LOG_LEVEL || bunyan.INFO,
        serializers: bunyan.stdSerializers
    });
    LOG.addSerializers({
        buffer: function (buf) {
            return buf.toString();
        }
    });

    var TCP_SERVER_STREAM;
    var TCP_SERVER;
    var SERVER_F_STREAM = new FramingStream({
        log: LOG
    });
    var SERVER_S_STREAM = new SerializeStream({
        log: LOG,
        metadataEncoding: METADATA_ENCODING,
        dataEncoding: DATA_ENCODING
    });
    var SERVER_P_STREAM = new ParseStream({
        log: LOG,
        metadataEncoding: METADATA_ENCODING,
        dataEncoding: DATA_ENCODING
    });

    var TCP_CLIENT_STREAM;
    var CLIENT_F_STREAM = new FramingStream({
        log: LOG
    });
    var CLIENT_S_STREAM = new SerializeStream({
        log: LOG,
        metadataEncoding: METADATA_ENCODING,
        dataEncoding: DATA_ENCODING
    });
    var CLIENT_P_STREAM = new ParseStream({
        log: LOG,
        metadataEncoding: METADATA_ENCODING,
        dataEncoding: DATA_ENCODING
    });

    before(function (done) {
        TCP_SERVER = net.createServer(function (con) {
            TCP_SERVER_STREAM = con;
            TCP_SERVER_STREAM.pipe(SERVER_F_STREAM).pipe(SERVER_P_STREAM);
            SERVER_S_STREAM.pipe(TCP_SERVER_STREAM);
        });

        TCP_SERVER.listen({
            port: PORT,
            host: HOST
        }, function (err) {
            if (err) {
                throw err;
            }

            TCP_CLIENT_STREAM = net.connect(PORT, HOST, function (e) {
                if (e) {
                    throw e;
                }

                TCP_CLIENT_STREAM.pipe(CLIENT_F_STREAM).pipe(CLIENT_P_STREAM);
                CLIENT_S_STREAM.pipe(TCP_CLIENT_STREAM);
                return done();
            });
        });
    });

    after(function (done) {
        var count = 0;
        TCP_CLIENT_STREAM.once('close', function () {
            count++;

            if (count === 2) {
                done();
            }
        });
        TCP_SERVER_STREAM.on('end', function () {
            TCP_SERVER.close(function () {
                count++;

                if (count === 2) {
                    done();
                }
            });
        });
        TCP_SERVER_STREAM.end();
        TCP_CLIENT_STREAM.end();
    });

    afterEach(function () {
        SERVER_P_STREAM.removeAllListeners('readable');
        CLIENT_P_STREAM.removeAllListeners('readable');
    });

    it('tcp client/server serialize/parse frames', function (done) {
        // check that we are actually framing. _transform should be called more
        // than twice since we send at least 2 frames
        var serverFrameSpy = sinon.spy(SERVER_F_STREAM, '_transform');
        var clientFrameSpy = sinon.spy(CLIENT_F_STREAM, '_transform');

        var isDone = 0;
        var seedFrame = {
            type: TYPES.SETUP,
            flags: FLAGS.LEASE | FLAGS.STRICT,
            keepalive: getRandomInt(0, Math.pow(2, 32)),
            maxLifetime: getRandomInt(0, Math.pow(2, 32)),
            version: CONSTANTS.VERSION,
            metadataEncoding: METADATA_ENCODING,
            dataEncoding: DATA_ENCODING,
            metadata: JULIUS_CAESAR,
            data: HAMLET
        };

        SERVER_P_STREAM.on('readable', function () {
            var actualFrame = SERVER_P_STREAM.read();
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
            isDone++;

            if (isDone === 4) {
                assert.isAtLeast(serverFrameSpy.callCount, 3);
                assert.isAtLeast(clientFrameSpy.callCount, 3);
                done();
            }
        });

        CLIENT_P_STREAM.on('readable', function () {
            var actualFrame = CLIENT_P_STREAM.read();
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
            isDone++;

            if (isDone === 4) {
                assert.isAtLeast(serverFrameSpy.callCount, 3);
                assert.isAtLeast(clientFrameSpy.callCount, 3);
                done();
            }
        });

        SERVER_S_STREAM.write(seedFrame);
        CLIENT_S_STREAM.write(seedFrame);
        SERVER_S_STREAM.write(seedFrame);
        CLIENT_S_STREAM.write(seedFrame);
    });
});

