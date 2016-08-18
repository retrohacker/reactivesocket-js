'use strict';

var BucketedHistogram = require('../stats/bucketedhistogram.js');
var DefaultCounter = require('../counter/counter.js');
var DefaultTimer = require('../timer/timer.js');

/**
 * Default configuration.
 * Capture and aggregate all events.
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
        histogram: function (name) {
            return new BucketedHistogram({
                max: 60 * 60 * 1000,        // 1 hour
                error: 5 / 100,             // 5% precision
                quantiles: [0.5, 0.9, 0.99] // default quantiles
            });
        },
        composites: null
    }
};

module.exports = config;
