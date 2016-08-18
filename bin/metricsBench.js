#!/usr/bin/env node
'use strict';

var _ = require('lodash');

var Aggregator = require('../lib/metrics/aggregator.js');
var BucketedHistogram = require('../lib/metrics/stats/bucketedhistogram.js');
var getRandomInt = require('../test/common/getRandomInt.js');
var getSemaphore = require('../test/common/getSemaphore.js');
var NullCounter = require('../lib/metrics/counter/null.js');
var NullTimer = require('../lib/metrics/timer/null.js');
var Recorder = require('../lib/metrics/recorder.js');
var StreamingHistogram = require('../lib/metrics/stats/streaminghistogram.js');

function measure(f, iterations) {
    var sum = 0;
    var min = Number.MAX_VALUE;
    var max = Number.MIN_VALUE;
    var warmUp = 3;
    var tries = 10;

    for (var t = 0; t < warmUp + tries; t++) {
        var i = iterations;

        var start = Date.now();

        while (i > 0) {
            f();
            i--;
        }
        var elapsed = Date.now() - start;

        if (t >= warmUp) {
            var d = 1000.0 * elapsed / iterations;
            sum += d;
            min = Math.min(min, d);
            max = Math.max(max, d);
        }
    }
    return [sum / tries, min, max];
}

function time(f, iterations, baseline, name) {
    var results = measure(f, iterations);
    var avg = Math.max(0, results[0] - baseline[0]);
    var min = Math.max(0, results[1] - baseline[1]);
    var max = Math.max(0, results[2] - baseline[2]);
    var unit = 'µs';

    if (avg > 1000) {
        avg /= 1000;
        min /= 1000;
        max /= 1000;
        unit = 'ms';
    }
    var prefix = '  ' + name;
    var padding = ' '.repeat(40 - prefix.length);
    console.log(prefix + padding + 'avg: ' + avg.toFixed(3) + unit +
        '\tmin: ' + min.toFixed(3) + unit + '\tmax: ' + max.toFixed(3) + unit);
}

function shuffle(array) {
    var j, x, i;

    for (i = array.length; i; i--) {
        j = Math.floor(Math.random() * i);
        x = array[i - 1];
        array[i - 1] = array[j];
        array[j] = x;
    }
}

function bench(iterations) {
    console.log('counter/timer');
    console.log('*************');

    var emptyFunction = function () { };
    var baseline = measure(emptyFunction, iterations);

    var recorder = new Recorder();
    var aggregator = new Aggregator(recorder, {
        histogram: function (name) {
            if (name.startsWith('rs')) {
                return new BucketedHistogram({
                    error: 1 / 100,
                    max: 1000,
                    quantiles: [0.1, 0.5, 0.75, 0.9, 0.95, 0.99, 0.999, 0.9999]
                });
            } else {
                return new BucketedHistogram();
            }
        }
    });

    var disabledRecorder = new Recorder({
        counter: function (_recorder, name, tags) {
            return NullCounter;
        },
        timer: function (_recorder, name, tags) {
            return NullTimer;
        }
    });
    var disabledAggregator = new Aggregator(disabledRecorder);

    var recorder2 = new Recorder();
    var cheapAggregator = new Aggregator(recorder2, {
        histogram: function (name) {
            return new StreamingHistogram();
        }
    });

    time(function () {
        recorder.counter('toto');
    }, iterations, baseline, 'create counter');

    var counter = recorder.counter('cccc');
    time(function () {
        counter.incr();
    }, iterations, baseline, 'increment counter');

    time(function () {
        disabledRecorder.counter('toto');
    }, iterations, baseline, 'create disabled counter');

    var counter2 = disabledRecorder.counter('cccc');
    time(function () {
        counter2.incr();
    }, iterations, baseline, 'increment disabled counter');


    time(function () {
        recorder.timer('titi');
    }, iterations, baseline, 'create timer (bucket)');

    var timer = recorder.timer('tttt');
    time(function () {
        var id = timer.start();
        timer.stop(id);
    }, iterations, baseline, 'start/stop timer (bucket)');

    time(function () {
        recorder2.timer('titi');
    }, iterations, baseline, 'create timer (streaming)');

    var stimer = recorder2.timer('ssss');
    time(function () {
        var id = stimer.start();
        stimer.stop(id);
    }, iterations, baseline, 'start/stop timer (streaming)');

    time(function () {
        disabledRecorder.timer('titi');
    }, iterations, baseline, 'create disabled timer');

    var timer2 = disabledRecorder.timer('tttt');
    time(function () {
        var id = timer2.start();
        timer2.stop(id);
    }, iterations, baseline, 'start/stop disabled timer');

    console.log('');
    console.log('Aggregator report');
    console.log('*****************');
    iterations /= 200; // expensive work

    var n = 200; // number of metrics
    var m = 5000; // number of data points in the histograms
    var semaphore = getSemaphore(4 * m * n, function () {
        console.log('done');

        time(function () {
            aggregator.report();
        }, iterations, baseline, 'aggregator report (bucket histo)');

        time(function () {
            cheapAggregator.report();
        }, iterations, baseline, 'aggregator report (streaming histo)');

        time(function () {
            disabledAggregator.report();
        }, iterations, baseline, 'disabled-aggregator report');
    });

    process.stdout.write('creating fake data...');

    var rsTimer = recorder.scope('rs').timer('rs');
    var timersAndIds = [];
    _.each(_.range(n), function (j) {
        recorder.counter('toto' + j, getRandomInt(0, 1000));
        recorder2.counter('toto' + j, getRandomInt(0, 1000));
        disabledRecorder.counter('toto' + j, getRandomInt(0, 1000));

        var timer0 = recorder.timer('histo' + j);
        var ctimer2 = recorder2.timer('histo' + j);
        var timerd0 = disabledRecorder.timer('histo' + j);
        _.each(_.range(m), function (k) {
            timersAndIds.push({timer: timer0, id: timer0.start()});
            timersAndIds.push({timer: ctimer2, id: ctimer2.start()});
            timersAndIds.push({timer: timerd0, id: timerd0.start()});
            timersAndIds.push({timer: rsTimer, id: rsTimer.start()});
        });
    });

    shuffle(timersAndIds);

    _.each(timersAndIds, function (obj) {
        obj.timer.stop(obj.id);
        semaphore.latch();
    });
}

bench(200 * 1000);
