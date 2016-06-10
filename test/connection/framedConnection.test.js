'use strict';

var fs = require('fs');
var net = require('net');

var _ = require('lodash');
var assert = require('chai').assert;
var bunyan = require('bunyan');

var reactiveSocket = require('../../lib');

var ERROR_CODES = reactiveSocket.ERROR_CODES;

var PORT = process.env.PORT || 1337;
var HOST = process.env.HOST || 'localhost';

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

describe('frame-connection-setup', function () {

    var LOG = bunyan.createLogger({
        name: 'framed connection setup tests',
        level: process.env.LOG_LEVEL || bunyan.INFO,
        serializers: bunyan.stdSerializers
    });

    LOG.addSerializers({
        buffer: function (buf) {
            return buf.toString();
        }
    });

    var TCP_SERVER;
    var TCP_CLIENT_STREAMS = [];

    before(function (done) {
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

    after(function (done) {
        TCP_SERVER.close(done);

        TCP_CLIENT_STREAMS.forEach(function (stream) {
            stream.end();
        });
    });

    it('extra setup frame', function (done) {

        TCP_SERVER.once('connection', function (server) {

            var rs = reactiveSocket.createConnection({
                log: LOG,
                transport: {
                    stream: server,
                    framed:true
                },
                type: 'server'
            });

            rs.once('setup-error', function (err) {
                done();
            });

        });

        var client = net.connect(PORT, HOST, function (e) {

            TCP_CLIENT_STREAMS.push(client);

            var rc = reactiveSocket.createConnection({
                log: LOG,
                transport: {
                    stream: client,
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

        TCP_SERVER.once('connection', function (server) {

            var rs = reactiveSocket.createConnection({
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

        var client = net.connect(PORT, HOST, function (e) {

            TCP_CLIENT_STREAMS.push(client);

            if (e) {
                throw e;
            }

            reactiveSocket.createConnection({
                log: LOG,
                transport: {
                    stream: client,
                    framed: true
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

describe('framed-connection', function () {
    var LOG = bunyan.createLogger({
        name: 'framed connection tests',
        level: process.env.LOG_LEVEL || bunyan.INFO,
        serializers: bunyan.stdSerializers
    });
    LOG.addSerializers({
        buffer: function (buf) {
            return buf.toString();
        }
    });

    var TCP_SERVER;
    var TCP_SERVER_STREAM;
    var TCP_CLIENT_STREAM;

    var SERVER_CON;
    var CLIENT_CON;

    before(function (done) {
        TCP_SERVER = net.createServer(function (con) {
            TCP_SERVER_STREAM = con;
            SERVER_CON = reactiveSocket.createConnection({
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

            TCP_CLIENT_STREAM = net.connect(PORT, HOST, function (e) {
                if (e) {
                    throw e;
                }
                CLIENT_CON = reactiveSocket.createConnection({
                    log: LOG,
                    transport: {
                        stream: TCP_CLIENT_STREAM,
                        framed: true
                    },
                    type: 'client',
                    metadataEncoding: 'utf-8',
                    dataEncoding: 'utf-8'
                });

                CLIENT_CON.on('ready', done);
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

    it('req/res', function (done) {
        SERVER_CON.once('request', function (stream) {
            assert.deepEqual(stream.getRequest(), EXPECTED_REQ);
            stream.response(_.cloneDeep(EXPECTED_RES));
            setImmediate(function () {
                // should only have the setup stream cached in the connection
                assert.equal(Object.keys(SERVER_CON._streams.streams).length,
                             1);
                assert.isOk(SERVER_CON._streams.streams[0]);
            });
        });

        var response = CLIENT_CON.request(_.cloneDeep(EXPECTED_REQ));

        response.once('response', function (res) {
            assert.deepEqual(res.getResponse(), EXPECTED_RES);
            setImmediate(function () {
                // should only have the setup stream cached in the connection
                assert.equal(Object.keys(CLIENT_CON._streams.streams).length,
                             1);
                assert.isOk(CLIENT_CON._streams.streams[0]);
                done();
            });
        });
    });

    it('req/res once more', function (done) {
        SERVER_CON.once('request', function (stream) {
            assert.deepEqual(stream.getRequest(), EXPECTED_REQ);
            stream.response(_.cloneDeep(EXPECTED_RES));
            setImmediate(function () {
                // should only have the setup stream cached in the connection
                assert.equal(Object.keys(SERVER_CON._streams.streams).length,
                             1);
                assert.isOk(SERVER_CON._streams.streams[0]);
            });
        });

        var response = CLIENT_CON.request(_.cloneDeep(EXPECTED_REQ));

        response.once('response', function (res) {
            assert.deepEqual(res.getResponse(), EXPECTED_RES);
            setImmediate(function () {
                // should only have the setup stream cached in the connection
                assert.equal(Object.keys(CLIENT_CON._streams.streams).length,
                             1);
                assert.isOk(CLIENT_CON._streams.streams[0]);
                done();
            });
        });
    });

    it('req/err', function (done) {
        SERVER_CON.once('request', function (stream) {
            assert.deepEqual(stream.getRequest(), EXPECTED_REQ);
            stream.error(_.cloneDeep(EXPECTED_APPLICATION_ERROR));
            setImmediate(function () {
                // should only have the setup stream cached in the connection
                assert.equal(Object.keys(SERVER_CON._streams.streams).length,
                             1);
                assert.isOk(SERVER_CON._streams.streams[0]);
            });
        });

        var response = CLIENT_CON.request(_.cloneDeep(EXPECTED_REQ));

        response.once('application-error', function (err) {
            assert.deepEqual(_.omit(err, 'header', 'metadataEncoding',
                                    'dataEncoding'),
                                    EXPECTED_APPLICATION_ERROR);
            setImmediate(function () {
                // should only have the setup stream cached in the connection
                assert.equal(Object.keys(CLIENT_CON._streams.streams).length,
                             1);
                assert.isOk(CLIENT_CON._streams.streams[0]);
                done();
            });
        });
    });
});
