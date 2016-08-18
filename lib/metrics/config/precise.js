'use strict';

var BucketedHistogram = require('../lib/metrics/stats/bucketedhistogram.js');
var DefaultCounter = require('./counter/counter.js');
var DefaultTimer = require('./timer/timer.js');

/**
 * Precise configuration.
 * Capture and aggregate all events (timer events are aggregated with a
 * detailed histogram).
 */
var config = {
    recorder: {
        timer: function (recorder, name, tags) {
            return DefaultTimer(recorder, name, tags);
        },
        counter: function (recorder, name, value, tags) {
            return DefaultCounter(recorder, name, value, tags);
        }
    },
    aggregator: {
        timer: {
            factory: function (name) {
                return new BucketedHistogram({
                    max: 60 * 1000 * 1000,
                    error: 1 / 100,
                    quantiles: [0.5, 0.9, 0.95, 0.99, 0.999, 0.9999]
                });
            }
        }
    }
};

module.exports = config;
