'use strict';

var _ = require('lodash');
var assert = require('chai').assert;

var Ws = require('ws');
var WSStream = require('yws-stream');

var getRandomInt = require('../common/getRandomInt');

var ParseStream = require('../../lib/streams/parseStream.js');
var SerializeStream = require('../../lib/streams/serializeStream');

var CONSTANTS = require('../../lib/protocol/constants');
var FLAGS = require('../../lib/protocol/constants').FLAGS;
var TYPES = require('../../lib/protocol/constants').TYPES;
var PORT = process.env.PORT || 1337;

var METADATA_ENCODING = 'binary';
var DATA_ENCODING = 'ascii';

var LOG = require('../common/log');


describe('RS WS Integ Tests', function () {
    var WS_SERVER;
    var WS_CLIENT;
    var WS_SERVER_STREAM;
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
    var WS_CLIENT_STREAM;
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
        WS_SERVER = new Ws.Server({port: PORT});
        WS_SERVER.on('connection', function (socket) {
            WS_SERVER_STREAM = new WSStream({
                log: LOG,
                ws: socket
            });
            SERVER_S_STREAM.pipe(WS_SERVER_STREAM);
            WS_SERVER_STREAM.pipe(SERVER_P_STREAM);
        });

        WS_CLIENT = new Ws('ws://localhost:' + PORT);
        WS_CLIENT.on('open', function () {
            WS_CLIENT_STREAM = new WSStream({
                log: LOG,
                ws: WS_CLIENT
            });

            CLIENT_S_STREAM.pipe(WS_CLIENT_STREAM);
            WS_CLIENT_STREAM.pipe(CLIENT_P_STREAM);
            done();
        });
    });

    after(function () {
        // We really should not end this until we know the server is closed.
        // Unfortunately ws does not provide an API to let us know that the
        // server has been closed.
        // This might introduce race conditions between tests.
        WS_CLIENT.close();
        WS_SERVER.close();
    });

    it('ws client/server serialize/parse frames', function (done) {
        var isDone = 0;
        var seedFrame = {
            type: TYPES.SETUP,
            flags: FLAGS.LEASE | FLAGS.STRICT,
            keepalive: getRandomInt(0, Math.pow(2, 32)),
            maxLifetime: getRandomInt(0, Math.pow(2, 32)),
            version: CONSTANTS.VERSION,
            metadataEncoding: METADATA_ENCODING,
            dataEncoding: DATA_ENCODING,
            metadata: 'We\'re just two lost souls swimming in a fish bowl',
            data: 'year after year'
        };

        SERVER_P_STREAM.once('readable', function () {
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

            if (isDone === 2) {
                done();
            }
        });

        CLIENT_P_STREAM.once('readable', function () {
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

            if (isDone === 2) {
                done();
            }
        });

        SERVER_S_STREAM.write(seedFrame);
        CLIENT_S_STREAM.write(seedFrame);
    });
});
