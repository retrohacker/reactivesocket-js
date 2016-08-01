'use strict';

var net = require('net');
var assert = require('chai').assert;
var bunyan = require('bunyan');

var reactiveSocket = require('../../lib');

var PORT = process.env.PORT || 1337;
var HOST = process.env.HOST || 'localhost';

describe('Lease test', function () {

    var LOG = bunyan.createLogger({
        name: 'lease tests',
        level: process.env.LOG_LEVEL || bunyan.INFO,
        serializers: bunyan.stdSerializers
    });

    LOG.addSerializers({
        buffer: function (buf) {
            return buf.toString();
        }
    });

    var TCP_SERVER;
    var TCP_CLIENT;
    var TCP_CLIENT_STREAM;


    beforeEach(function (done) {
        TCP_SERVER = net.createServer(function (con) {
            reactiveSocket.createConnection({
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
            done();
        });
    });

    afterEach(function (done) {
        TCP_CLIENT_STREAM.end();
        TCP_SERVER.close(done);
    });

    it('should wait for lease at startup', function (done) {
        TCP_CLIENT_STREAM = net.connect(PORT, HOST, function (e) {
            if (e) {
                throw e;
            }

            TCP_CLIENT = reactiveSocket.createConnection({
                log: LOG,
                transport: {
                    stream: TCP_CLIENT_STREAM,
                    framed: true
                },
                lease: true,
                type: 'client',
                metadataEncoding: 'utf-8',
                dataEncoding: 'utf-8'
            });

            var CLIENT_LEASE_RECEIVED = false;
            TCP_CLIENT.on('lease', function () {
                CLIENT_LEASE_RECEIVED = true;
            });
            TCP_CLIENT.on('ready', function () {
                assert.equal(CLIENT_LEASE_RECEIVED, true);
                done();
            });
        });
    });

    it('close() stops running timers (keepalive, lease, ...)', function (done) {
        TCP_CLIENT_STREAM = net.connect(PORT, HOST, function (e) {
            if (e) {
                throw e;
            }

            TCP_CLIENT = reactiveSocket.createConnection({
                log: LOG,
                transport: {
                    stream: TCP_CLIENT_STREAM,
                    framed: true
                },
                lease: true,
                keepalive: 50,
                type: 'client',
                metadataEncoding: 'utf-8',
                dataEncoding: 'utf-8'
            });

            TCP_CLIENT.on('ready', function () {
                TCP_CLIENT.close();
                var keepaliveSeen = 0;
                TCP_CLIENT.on('keepalive', function () {
                    keepaliveSeen++;
                });
                setTimeout(function () {
                    assert.equal(keepaliveSeen, 0,
                        "Keepalive timer wasn't properly stopped!");
                    done();
                }, 1000);
            });
        });
    });
});
