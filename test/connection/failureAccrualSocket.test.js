'use strict';

var assert = require('chai').assert;
var net = require('net');

var reactiveSocket = require('../../lib');
var getSemaphore = require('../../lib/common/getSemaphore');

var ReactiveSocketFactory =
    require('../../lib/connection/reactiveSocketFactory');
var FailureAccrualSocket =
    require('../../lib/connection/failureAccrualSocket');

var CONSTANTS = require('../../lib/protocol/constants');


describe('FailureReactiveSocket', function () {
    var SERVER = null;

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
                    var req = stream.getRequest();
                    var data = req.data;

                    if (Math.random() > 0.5) {
                        stream.response({data: data});
                    } else {
                        stream.error({
                            data: data,
                            errorCode: CONSTANTS.ERROR_CODES.APPLICATION_ERROR
                        });
                    }
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

    it('Create a FailureReactiveSocket', function (done) {
        var WINDOW = 10000;
        var INTERVAL = 1000;
        var MSG_COUNT = 100;

        var t = 0;
        var clock = {
            now: function () {
                t += INTERVAL;
                return t;
            }
        };

        var factory = new ReactiveSocketFactory({
            port: SERVER.address().port,
            host: '127.0.0.1'
        });

        factory.build().on('reactivesocket', function (rs) {
            var frs = FailureAccrualSocket(rs, WINDOW, clock);

            var semaphore = getSemaphore(MSG_COUNT, function () {
                var av = frs.availability();
                assert(av < 0.70, 'RS availability is now ~0.5');
                assert(av > 0.30, 'RS availability is now ~0.5');
                done();
            });

            function sequence(i) {
                frs.request({data: 'data', metadata: ''})
                    .on('terminate', function (res) {
                        semaphore.latch();

                        if (i > 0) {
                            sequence(i - 1);
                        }
                    });
            }
            sequence(MSG_COUNT);
        });
    });
});
