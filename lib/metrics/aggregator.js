'use strict';

var util = require('util');
var EventEmitter = require('events');
var assert = require('assert-plus');
var _ = require('lodash');

var DefaultConfig = require('./config/default.js');

/**
 * Aggregator
 *
 * The aggregator listen to the aggregator events (counter/timer) and aggregates
 * those events into respectively values/histograms.
 *
 * This abstraction reflect the "separation of concern" strategy used in this
 * library, the aggregator decides how it want to aggregate the values. It may
 * be interested in specific metrics and decide to aggregate them with an higher
 * precision.
 *
 * @param {Object} recorder Recorder the aggregator listen to.
 * @param {Object} _config Config object.
 * @param {Func} [_config.histogram] the function used to create an histogram.
 * @param {Func} [_config.composites] the function used to create new metrics
 *               from existing metrics.
 * @returns {Aggregator}
 */

function Aggregator(recorder, _config) {
    EventEmitter.call(this);
    var config = _config || DefaultConfig.aggregator;
    assert.object(recorder, 'recorder');
    assert.object(config, 'config');
    assert.optionalFunc(config.histogram, 'config.histogram');
    assert.optionalArray(config.composites, 'config.composites');

    var histogramFactory = config.histogram ||
        DefaultConfig.aggregator.histogram;
    this._composites = config.composites;
    this._counters = {};
    this._histograms = {};
    var self = this;

    recorder.on('timer', function onTimer(event) {
        if (!self._histograms[event.name]) {
            self._histograms[event.name] = histogramFactory(event.name);
        }

        if (event.startTs) {
            var duration = event.stopTs - event.startTs;
            var histo = self._histograms[event.name];
            histo.add(duration);
        }
    });
    recorder.on('counter', function onCounter(event) {
        self._counters[event.name] = event.value;
    });
}

util.inherits(Aggregator, EventEmitter);

module.exports = Aggregator;

/// API

/**
 * Generate a report
 *
 * @returns {Object} the report object.
 */
Aggregator.prototype.report = function report() {
    var self = this;
    var result = {
        counters: self._counters,
        histograms: _.mapValues(self._histograms, function histoSnapshot(h) {
            return h.snapshot();
        })
    };

    // optionally create new composite metrics based on the current ones.
    if (self._composites) {
        _.forEach(self._composites, function (fn) {
            var res = fn(result.counters, result.histograms);

            if (res) {
                for (var i = 0; i < res.length; i += 2) {
                    var name = res[i];
                    var value = res[i + 1];
                    self._counters[name] = value;
                }
            }
        });
    }

    return result;
};

/**
 * Clear the aggregator of any state.
 *
 * @returns {null}.
 */
Aggregator.prototype.clear = function clear() {
    var self = this;
    self._counters = {};
    self._histograms = {};
};
