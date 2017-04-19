'use strict';

var assert = require('chai').assert;
var net = require('net');
var metrix = require('metrix');

var reactiveSocket = require('../../lib');
var getSemaphore = require('../../lib/common/getSemaphore');

var ReactiveSocketFactory =
    require('../../lib/connection/reactiveSocketFactory');
var ReEnqueueFilter =
    require('../../lib/connection/reEnqueueFilter');

var ERROR_CODES = require('../../lib/protocol/constants').ERROR_CODES;

describe('ReEnqueueFilter', function () {
    var SERVER = null;

    beforeEach(function (done) {
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
                        switch (data) {
                            case 'REJECTED':
                                stream.error({
                                    data: data,
                                    errorCode: ERROR_CODES.REJECTED
                                });
                                break;
                            case 'APPLICATION':
                                stream.error({
                                    data: data,
                                    errorCode: ERROR_CODES.APPLICATION_ERROR
                                });
                                break;
                            default:

                        }
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

    function sequenceCalls(
        factory, recorder, semaphore, error, count, max, maxRate, counters) {
        factory.build().on('reactivesocket', function (rs) {

            var rrs = ReEnqueueFilter(rs, {
                recorder: recorder,
                maxReEnqueue: max,
                maxReEnqueueRate: maxRate
            });

            function sequence(i) {
                function continueSequence() {
                    if (i > 0) {
                        semaphore.latch();
                        sequence(i - 1);
                    } else {
                        semaphore.latch();
                    }
                }

                rrs.request({data: error, metadata: ''})
                    .on('response', function (res) {
                        counters.responses++;
                    })
                    .on('rejected-error', function (err) {
                        counters.rejected++;
                    })
                    .on('application-error', function (err) {
                        counters.applicationError++;
                    })
                    .on('terminate', function (err) {
                        counters.terminates++;
                        continueSequence();
                    })
                    .on('error', function (err) {
                        assert(false, 'Should not see an error! ' + err);
                    });
            }
            sequence(count);
        });
    }

    it('should re-enqueue rejected error', function (done) {
        var MSG_COUNT = 100;

        var factory = new ReactiveSocketFactory({
            port: SERVER.address().port,
            host: '127.0.0.1'
        });

        var RECORDER = metrix.createRecorder();
        var AGGREGATOR = metrix.createAggregator(RECORDER);

        var counters = {
            responses:0,
            terminates:0,
            rejected:0,
            applicationError: 0
        };

        var semaphore = getSemaphore(MSG_COUNT, function () {
            var report = AGGREGATOR.report();

            assert.isAtLeast(report.counters.reEnqueues, 0.5 * MSG_COUNT / 2,
                'should have re-enqueue roughly 50% of messages '
                + '(dividing by 2 for safety)');

            assert.equal(counters.responses + counters.rejected, MSG_COUNT,
                'Receive 1 response or rejected for every request');
            assert.equal(counters.terminates, MSG_COUNT,
                'Receive 1 terminate for every request');
            done();
        });

        sequenceCalls(
            factory, RECORDER, semaphore, 'REJECTED',
            MSG_COUNT, MSG_COUNT, 1.0, counters);
    });

    it('should automatically adjust re-enqueue rate', function (done) {
        var MSG_COUNT = 100;

        var factory = new ReactiveSocketFactory({
            port: SERVER.address().port,
            host: '127.0.0.1'
        });

        var RECORDER = metrix.createRecorder();
        var AGGREGATOR = metrix.createAggregator(RECORDER);

        var counters = {
            responses:0,
            terminates: 0,
            rejected: 0,
            applicationError: 0
        };
        var semaphore = getSemaphore(MSG_COUNT, function () {
            var report = AGGREGATOR.report();

            assert.approximately(counters.rejected, MSG_COUNT / 2,
                 MSG_COUNT / 4, '50% of rejection '
                 + '(reenque was capped by the max 5% rate)');
            assert.isBelow(report.counters.reEnqueues, 0.5 * MSG_COUNT / 2,
                'should have re-enqueue less than the # of rejected messages');
            assert.equal(counters.terminates, MSG_COUNT,
                'Receive 1 terminate for every request');

            done();
        });

        sequenceCalls(
            factory, RECORDER, semaphore, 'REJECTED',
            MSG_COUNT, 2, 0.05, counters);
    });

});
