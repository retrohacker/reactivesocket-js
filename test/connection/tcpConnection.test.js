'use strict';

var fs = require('fs');
var net = require('net');

var _ = require('lodash');
var assert = require('chai').assert;

var reactiveSocket = require('../../lib');
var getSemaphore = require('../../lib/common/getSemaphore');

var ERROR_CODES = reactiveSocket.ERROR_CODES;
var LOG = require('../common/log');

var PORT = process.env.PORT || 1337;
var HOST = process.env.HOST || 'localhost';

var CLIENT_CONN_OPTS = {
    port: PORT,
    host: HOST
};

// we need to send a large enough frame to ensure we exceed the default TCP
// loopback MTU of 16384 bytes. This is to test that framing actually works.
// Hence we read in some select works of the Bard.
var HAMLET = fs.readFileSync('./test/etc/hamlet.txt', 'utf8');
var JULIUS_CAESAR = fs.readFileSync('./test/etc/julius_caesar.txt', 'utf8');

var EXPECTED_REQ = {
    data: HAMLET,
    metadata: JULIUS_CAESAR
};

var EXPECTED_RES = {
    data: JULIUS_CAESAR,
    metadata: HAMLET
};

var EXPECTED_APPLICATION_ERROR = {
    errorCode: ERROR_CODES.APPLICATION_ERROR,
    metadata: HAMLET,
    data: JULIUS_CAESAR
};

describe('TcpConnection', function () {
    var TCP_SERVER;
    var TCP_CLIENT;

    beforeEach(function (done) {
        TCP_SERVER = net.createServer();
        TCP_SERVER.listen({
            port: PORT,
            host: HOST
        }, function (err) {
            if (err) {
                throw err;
            }
            done();
        });
    });

    afterEach(function (done) {
        TCP_CLIENT.close();
        TCP_SERVER.close(done);
    });

    it('should reconnect when server closes connection', function (done) {
        TCP_SERVER.on('connection', function (server) {
            var rs = reactiveSocket.createReactiveSocket({
                log: LOG,
                transport: {
                    stream: server,
                    framed:true
                },
                type: 'server'
            });

            // we want to end the server 3 times and see if the client
            // reconnects
            var endCount = 3;
            rs.on('ready', function () {
                endCount--;

                if (endCount === 0) {
                    return;
                }
                server.end();
            });
        });

        TCP_CLIENT = reactiveSocket.createTcpConnection({
            log: LOG,
            connOpts: CLIENT_CONN_OPTS,
            reconnect: true
        });

        var readyCount = 0;
        var closeCount = 0;
        TCP_CLIENT.on('ready', function () {
            readyCount++;

            // we check that the client has emitted ready 4 times, and that the
            // connection's been closed 3 times.
            if (readyCount === 4 && closeCount === 3) {
                done();
            }
        });

        TCP_CLIENT.on('close', function () {
            closeCount++;
        });
    });

    it('should reconnect when rs connection errors', function (done) {
        TCP_SERVER.on('connection', function (server) {
            var rs = reactiveSocket.createReactiveSocket({
                log: LOG,
                transport: {
                    stream: server,
                    framed:true
                },
                type: 'server'
            });

            // we want to end the server 3 times and see if the client
            // reconnects
            var endCount = 3;
            rs.on('ready', function () {
                endCount--;

                if (endCount === 0) {
                    return;
                }
                TCP_CLIENT.getConnection().emit('error');
            });
        });

        TCP_CLIENT = reactiveSocket.createTcpConnection({
            log: LOG,
            connOpts: CLIENT_CONN_OPTS,
            reconnect: true
        });

        var readyCount = 0;
        var closeCount = 0;
        TCP_CLIENT.on('ready', function () {
            readyCount++;

            // we check that the client has emitted ready 4 times, and that the
            // connection's been closed 3 times.
            if (readyCount === 4 && closeCount === 3) {
                done();
            }
        });

        TCP_CLIENT.on('close', function () {
            closeCount++;
        });
    });

    it('setup data and metadata', function (done) {

        var metadata = 'And if your head explodes with dark forboadings too';
        var data = 'I\'ll see you on the dark side of the moon';

        TCP_SERVER.once('connection', function (server) {

            var rs = reactiveSocket.createReactiveSocket({
                log: LOG,
                transport: {
                    stream: server,
                    framed:true
                },
                type: 'server'
            });

            rs.on('setup', function (stream) {
                assert.equal(stream.setup.metadata, metadata);
                assert.equal(stream.setup.data, data);

                done();
            });
        });

        TCP_CLIENT = reactiveSocket.createTcpConnection({
            log: LOG,
            connOpts: CLIENT_CONN_OPTS,
            rsOpts: {
                setupMetadata: metadata,
                setupData: data
            }
        });
    });
});

describe('TcpConnection functional tests', function () {
    var TCP_SERVER;
    var TCP_SERVER_STREAM;

    var SERVER_CON;
    var CLIENT_CON;

    before(function (done) {
        TCP_SERVER = net.createServer(function (con) {
            TCP_SERVER_STREAM = con;
            SERVER_CON = reactiveSocket.createReactiveSocket({
                log: LOG,
                transport: {
                    stream: con,
                    framed: true
                },
                type: 'server'
            });
        });

        TCP_SERVER.listen({
            port: PORT,
            host: HOST
        }, function (err) {
            if (err) {
                throw err;
            }

            CLIENT_CON = reactiveSocket.createTcpConnection({
                log: LOG,
                connOpts: CLIENT_CONN_OPTS,
                rsOpts: {
                    metadataEncoding: 'utf-8',
                    dataEncoding: 'utf-8'
                }
            });

            CLIENT_CON.on('ready', done);
        });
    });

    after(function (done) {
        var semaphore = getSemaphore(2, done);

        CLIENT_CON.once('close', function () {
            semaphore.latch();
        });
        TCP_SERVER_STREAM.on('end', function () {
            TCP_SERVER.close(function () {
                semaphore.latch();
            });
        });
        TCP_SERVER_STREAM.end();
        CLIENT_CON.close();
    });

    it('req/res', function (done) {
        SERVER_CON.once('request', function (stream) {
            assert.deepEqual(stream.getRequest(), EXPECTED_REQ);
            stream.response(_.cloneDeep(EXPECTED_RES));
        });

        var response = CLIENT_CON.getConnection().request(
            _.cloneDeep(EXPECTED_REQ));

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

        var response = CLIENT_CON.getConnection().request(
            _.cloneDeep(EXPECTED_REQ));

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

        var response = CLIENT_CON.getConnection().request(
            _.cloneDeep(EXPECTED_REQ));

        response.once('application-error', function (err) {
            assert.deepEqual(_.omit(err, 'header', 'metadataEncoding',
                                    'dataEncoding'),
                                    EXPECTED_APPLICATION_ERROR);
            done();
        });
    });
});
