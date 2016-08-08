'use strict';

var _ = require('lodash');
var assert = require('chai').assert;

var Ws = require('ws');
var WSStream = require('yws-stream');

var reactiveSocket = require('../../lib');
var getSemaphore = require('../common/getSemaphore');

var ERROR_CODES = reactiveSocket.ERROR_CODES;
var LOG = require('../common/log');

var PORT = process.env.PORT || 1337;

var EXPECTED_REQ = {
    data: 'so much trouble in the world',
    metadata: 'can\'t nobody feel your pain'
};

var EXPECTED_RES = {
    data: 'The world\'s changin everyday, times moving fast',
    metadata: 'My girl said I need a raise, how long will she last?'
};

var EXPECTED_APPLICATION_ERROR = {
    errorCode: ERROR_CODES.APPLICATION_ERROR,
    metadata: 'You gave them all those old time stars',
    data: 'Through wars of worlds - invaded by Mars'
};

describe('unframed-connection-setup', function () {
    var WS_SERVER;
    var WS_CLIENT_CONS = [];

    before(function (done) {
        WS_SERVER = new Ws.Server({port: PORT});
        WS_SERVER.on('listening', done);
    });

    after(function (done) {
        WS_CLIENT_CONS.forEach(function (conn) {
            conn.close();
        });

        WS_SERVER.close(done);
    });

    it('extra setup frame', function (done) {

        WS_SERVER.once('connection', function (socket) {

            var wsStream = new WSStream({
                log: LOG,
                ws: socket
            });

            var rs = reactiveSocket.createConnection({
                log: LOG,
                transport: {
                    stream: wsStream
                },
                type: 'server'
            });

            rs.once('setup-error', function (err) {
                done();
            });

        });

        var client = new Ws('ws://localhost:' + PORT);
        client.on('open', function () {

            WS_CLIENT_CONS.push(client);

            var rc = reactiveSocket.createConnection({
                log: LOG,
                transport: {
                    stream: new WSStream({log:LOG, ws:client}),
                    framed: true
                },
                type: 'client',
                metadataEncoding: 'utf-8',
                dataEncoding: 'utf-8'
            });

            rc.setup({
                metadata: 'You reached for the secret too soon',
                data: 'you cried for the moon.'
            }, function () {});
        });
    });

    it('setup data and metadata', function (done) {

        var metadata = 'And if your head explodes with dark forboadings too';
        var data = 'I\'ll see you on the dark side of the moon';

        WS_SERVER.once('connection', function (socket) {

            var wsStream = new WSStream({
                log: LOG,
                ws: socket
            });

            var rs = reactiveSocket.createConnection({
                log: LOG,
                transport: {
                    stream: wsStream
                },
                type: 'server'
            });

            rs.on('setup', function (stream) {
                assert.equal(stream.setup.metadata, metadata);
                assert.equal(stream.setup.data, data);

                done();
            });
        });

        var client = new Ws('ws://localhost:' + PORT);
        client.on('open', function () {

            WS_CLIENT_CONS.push(client);

            reactiveSocket.createConnection({
                log: LOG,
                transport: {
                    stream: new WSStream({log:LOG, ws:client})
                },
                type: 'client',
                metadataEncoding: 'utf-8',
                dataEncoding: 'utf-8',
                setupMetadata: metadata,
                setupData: data
            });
        });
    });
});

describe('connection', function () {
    var SERVER_CON;
    var CLIENT_CON;
    var WS_SERVER;
    var WS_CLIENT;
    var WS_SERVER_STREAM;
    var WS_CLIENT_STREAM;

    before(function (done) {
        var semaphore = getSemaphore(2, done);

        WS_SERVER = new Ws.Server({port: PORT});
        WS_SERVER.on('listening', function () {
            WS_SERVER.once('connection', function (socket) {
                WS_SERVER_STREAM = new WSStream({
                    log: LOG,
                    ws: socket
                });

                SERVER_CON = reactiveSocket.createConnection({
                    log: LOG,
                    transport: {
                        stream: WS_SERVER_STREAM
                    },
                    type: 'server'
                });

                SERVER_CON.on('ready', function () {
                    semaphore.latch();
                });
            });

            WS_CLIENT = new Ws('ws://localhost:' + PORT);
            WS_CLIENT.on('open', function () {
                WS_CLIENT_STREAM = new WSStream({
                    log: LOG,
                    ws: WS_CLIENT
                });
                CLIENT_CON = reactiveSocket.createConnection({
                    log: LOG,
                    transport: {
                        stream: WS_CLIENT_STREAM
                    },
                    type: 'client',
                    metadataEncoding: 'utf-8',
                    dataEncoding: 'utf-8'
                });

                CLIENT_CON.on('ready', function () {
                    semaphore.latch();
                });
            });
        });
    });

    after(function (done) {
        var semaphore = getSemaphore(2, done);
        SERVER_CON.on('close', function () {
            semaphore.latch();
        });
        CLIENT_CON.on('close', function () {
            semaphore.latch();
        });
        WS_CLIENT.close();
        WS_SERVER.close();
    });

    it('req/res', function (done) {
        SERVER_CON.once('request', function (stream) {
            assert.deepEqual(stream.getRequest(), EXPECTED_REQ);
            stream.response(_.cloneDeep(EXPECTED_RES));
        });

        var response = CLIENT_CON.request(_.cloneDeep(EXPECTED_REQ));

        response.once('response', function (res) {
            assert.deepEqual(res.getResponse(), EXPECTED_RES);
            done();
        });
    });

    it('req/res once more', function (done) {
        SERVER_CON.once('request', function (stream) {
            assert.deepEqual(stream.getRequest(), EXPECTED_REQ);
            stream.response(_.cloneDeep(EXPECTED_RES));
        });

        var response = CLIENT_CON.request(_.cloneDeep(EXPECTED_REQ));

        response.once('response', function (res) {
            assert.deepEqual(res.getResponse(), EXPECTED_RES);
            done();
        });
    });

    it('req/err', function (done) {
        SERVER_CON.once('request', function (stream) {
            assert.deepEqual(stream.getRequest(), EXPECTED_REQ);
            stream.error(_.cloneDeep(EXPECTED_APPLICATION_ERROR));
        });

        var response = CLIENT_CON.request(_.cloneDeep(EXPECTED_REQ));

        response.once('application-error', function (err) {
            assert.deepEqual(_.omit(err, 'header', 'metadataEncoding',
                                    'dataEncoding'),
                                    EXPECTED_APPLICATION_ERROR);
            done();
        });
    });
});
