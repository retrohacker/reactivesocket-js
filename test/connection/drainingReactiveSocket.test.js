'use strict';

var assert = require('chai').assert;
var net = require('net');

var reactiveSocket = require('../../lib');

var ReactiveSocketFactory =
    require('../../lib/connection/reactiveSocketFactory');
var DrainingReactiveSocket =
    require('../../lib/connection/drainingReactiveSocket');

var CONSTANTS = require('../../lib/protocol/constants');

describe('DrainingReactiveSocket', function () {
    var SERVER = null;
    var STREAM = null;

    beforeEach(function (done) {
        // Start a failing server (which fail ~50% of requests)
        SERVER = net.createServer();
        SERVER.listen({port: 0, host: '127.0.0.1'}, function (err) {
            if (err) {
                throw err;
            }

            SERVER.on('connection', function (s) {
                reactiveSocket.createReactiveSocket({
                    transport: {
                        stream: s,
                        framed: true
                    },
                    type: 'server'
                }).on('error', function (e) {
                    console.err('ERROR: ' + e);
                }).on('request', function (stream) {
                    STREAM = stream;
                });
            });

            SERVER.on('error', function (e) {
                throw e;
            });

            done();
        });
    });

    afterEach(function () {
        if (SERVER) {
            SERVER.close();
        }
    });

    it('Close a DrainingReactiveSocket after receiving the response',
        function (done) {
            var factory = new ReactiveSocketFactory({
                port: SERVER.address().port,
                host: '127.0.0.1'
            });

            factory.build().on('reactivesocket', function (rs) {
                var drs = DrainingReactiveSocket(rs);
                var responseReceived = false;

                drs.request({
                    data: 'REQUEST',
                    metadata: 'metadata'
                }).on('response', function () {
                    responseReceived = true;
                });


                drs.close(function onClose() {
                    assert(responseReceived,
                        'Response should be received before closing the RS');
                    done();
                });

                setTimeout(function () {
                    STREAM.response({data: 'RESPONSE'});
                }, 1000);
            });
        });

    it('Close a DrainingReactiveSocket after receiving an error',
        function (done) {
            var factory = new ReactiveSocketFactory({
                port: SERVER.address().port,
                host: '127.0.0.1'
            });

            factory.build().on('reactivesocket', function (rs) {
                var drs = DrainingReactiveSocket(rs);
                var responseReceived = false;

                drs.request({
                    data: 'REQUEST',
                    metadata: 'metadata'
                }).on('application-error', function () {
                    responseReceived = true;
                });


                drs.close(function onClose() {
                    assert(responseReceived,
                        'Error should be received before closing the RS');
                    done();
                });

                setTimeout(function () {
                    STREAM.error({
                        data: 'ERROR RESPONSE',
                        errorCode: CONSTANTS.ERROR_CODES.APPLICATION_ERROR
                    });

                }, 1000);
            });
        });

    it('Close a DrainingReactiveSocket after timeout',
        function (done) {
            var factory = new ReactiveSocketFactory({
                port: SERVER.address().port,
                host: '127.0.0.1'
            });

            factory.build().on('reactivesocket', function (rs) {
                var drs = DrainingReactiveSocket(rs, null, 100);
                var hasClosed = false;

                drs.request({
                    data: 'REQUEST',
                    metadata: 'metadata'
                }).on('error', function (err) {
                    assert(hasClosed,
                        'DriningRS has been closed by timeout and '
                        + 'the stream is seeing the error');
                    done();
                });

                drs.close(function onClose() {
                    hasClosed = true;
                });
            });
        });
});
