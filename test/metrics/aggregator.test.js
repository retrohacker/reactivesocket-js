'use strict';

var assert = require('chai').assert;
var expect = require('chai').expect;

var getSemaphore = require('../common/getSemaphore.js');
var getRandomInt = require('../common/getRandomInt.js');
var Recorder = require('../../lib/metrics/recorder.js');
var Aggregator = require('../../lib/metrics/aggregator.js');

describe('Aggregator', function () {
    it('works', function (done) {
        var recorder = new Recorder();
        var aggregator = new Aggregator(recorder);

        function finish() {
            var report = aggregator.report();

            assert.equal(report.counters.counter, 3);
            assert.equal(report.counters['connections/add'], 17);
            assert.equal(report.counters['connections/remove'], 2);

            expect(report.histograms.request_latency.min).to.be.within(0, 10);
            expect(report.histograms.request_latency.max).to.be.within(40, 70);
            expect(report.histograms.request_latency.p50).to.be.within(15, 35);
            expect(report.histograms.request_latency.p90).to.be.within(30, 55);
            expect(report.histograms.request_latency.p99).to.be.within(45, 70);

            var connectLatency =
                report.histograms['connections/connect_latency'];
            expect(connectLatency.min).to.be.within(0, 10);
            expect(connectLatency.max).to.be.within(40, 70);
            expect(connectLatency.p50).to.be.within(15, 35);
            expect(connectLatency.p90).to.be.within(30, 55);
            expect(connectLatency.p99).to.be.within(45, 70);

            done();
        }

        recorder.counter('counter', 3);
        var connections = recorder.scope('connections');
        connections.counter('add', 17);
        connections.counter('remove', 2);

        var n = 1 << 10;
        var semaphore = getSemaphore(n, finish);
        var requestLatency = recorder.timer('request_latency');

        for (var i = 0; i < n / 2; i++) {
            var id = requestLatency.start();
            setTimeout(function () {
                requestLatency.stop(id);
                semaphore.latch();
            }, getRandomInt(0, 50));
        }
        var connectionLatency = connections.timer('connect_latency');

        for (var j = 0; j < n / 2; j++) {
            var id2 = connectionLatency.start();
            setTimeout(function () {
                connectionLatency.stop(id2);
                semaphore.latch();
            }, getRandomInt(0, 50));
        }
    });

    it('create composite counters', function () {
        var recorder = new Recorder();
        var aggregator = new Aggregator(recorder, {
            composites: [
                function (counters, histograms) {
                    var current = counters['connections/add'] -
                        counters['connections/remove'];
                    return ['connections/current', current];
                },
                function (counters, histograms) {
                    var a = counters.a;
                    var b = counters.b;
                    var c = counters.c;
                    return ['d', a + b + c, 'e', a * b * c];
                }
            ]
        });

        var rec = recorder.scope('connections');
        var add = rec.counter('add');
        var remove = rec.counter('remove');
        add.incr();
        add.incr();
        add.incr();
        remove.incr();
        remove.incr();

        recorder.counter('a', 10);
        recorder.counter('b', 30);
        recorder.counter('c', 5);

        var report = aggregator.report();
        assert.equal(report.counters['connections/current'], 1);
        assert.equal(report.counters.d, 45);
        assert.equal(report.counters.e, 1500);
    });
});
