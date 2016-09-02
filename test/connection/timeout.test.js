'use strict';

var net = require('net');
var assert = require('chai').assert;
var bunyan = require('bunyan');

var reactiveSocket = require('../../lib');
var getSemaphore = require('../common/getSemaphore');


var PORT = process.env.PORT || 1337;
var HOST = process.env.HOST || 'localhost';

describe('Timeout tests', function () {

    var LOG = bunyan.createLogger({
        name: 'timeout tests',
        level: process.env.LOG_LEVEL || bunyan.INFO,
        serializers: bunyan.stdSerializers
    });

    LOG.addSerializers({
        buffer: function (buf) {
            return buf.toString();
        }
    });


    var TCP_SERVER;
    var TCP_CLIENT_STREAM;

    var SERVER_CON;
    var CLIENT_CON;

    beforeEach(function (done) {
        var count = 0;
        TCP_SERVER = net.createServer(function (con) {
            SERVER_CON = reactiveSocket.createReactiveSocket({
                log: LOG,
                transport: {
                    stream: con,
                    framed: true
                },
                type: 'server'
            });
            SERVER_CON.on('ready', function () {
                count++;

                if (count === 2) {
                    done();
                }
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
                CLIENT_CON = reactiveSocket.createReactiveSocket({
                    log: LOG,
                    transport: {
                        stream: TCP_CLIENT_STREAM,
                        framed: true
                    },
                    requestTimeoutMs: 100,
                    type: 'client',
                    metadataEncoding: 'utf-8',
                    dataEncoding: 'utf-8'
                });

                CLIENT_CON.on('ready', function () {
                    count++;

                    if (count === 2) {
                        done();
                    }
                });
            });
        });
    });

    afterEach(function (done) {
        CLIENT_CON.close();
        TCP_SERVER.close(done);
    });

    it('should cancel latent request', function (done) {
        var semaphore = getSemaphore(2, done);

        SERVER_CON.once('request', function (stream) {
            // The server never responds to the request
            stream.once('cancel', function () {
                semaphore.latch();
            });
        });

        var response = CLIENT_CON.request({data: 'request-data'});

        response.once('response', function (res) {
            assert(false,
                "I shouldn't receive that, it's too late, I cancelled it!");
        });
        response.once('timeout', function () {
            assert(response._expired);
            semaphore.latch();
        });
    });
});
