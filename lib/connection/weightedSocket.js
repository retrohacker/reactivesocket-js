'use strict';

var assert = require('assert-plus');

var SlidingMedian = require('../common/slidingMedian');

var STARTUP_PENALTY = Math.floor(Number.MAX_SAFE_INTEGER / 2);

var CLOCK = {
    now: function () {
        var t = process.hrtime();
        return (1e9 * t[0] + t[1]) / (1000 * 1000);
    }
};

function WeightedSocket(reactivesocket, opts) {
    assert.number(opts.inactivityPeriodMs, 'opts.inactivityPeriodMs');
    assert.number(opts.medianBufferSize, 'opts.medianBufferSize');

    reactivesocket._outstandings = 0;       // instantaneous rate
    reactivesocket._stamp = CLOCK.now();    // last timestamp we sent a request
    reactivesocket._stamp0 = reactivesocket._stamp; // last ts we sent a req.
    // or receive a resp.
    reactivesocket._duration = 0;          // instantaneous cumulative duration
    reactivesocket._inactivityPeriodMs = opts.inactivityPeriodMs;
    reactivesocket._median = new SlidingMedian(opts.medianBufferSize);

    /// Privates

    var _instantaneous = function _instantaneous(now) {
        return reactivesocket._duration +
            (now - reactivesocket._stamp0) * reactivesocket._outstandings;
    };

    var _incr = function _incr() {
        var now = CLOCK.now();
        reactivesocket._duration +=
            (now - reactivesocket._stamp0) * reactivesocket._outstandings;
        reactivesocket._outstandings += 1;
        reactivesocket._stamp = now;
        reactivesocket._stamp0 = now;
        return now;
    };

    // ts is the timestamp of when we sent the request
    // (that we receive a response to)
    var _decr = function _decr(ts) {
        var now = CLOCK.now();
        reactivesocket._duration +=
            (now - reactivesocket._stamp0) * reactivesocket._outstandings;
        reactivesocket._duration -= (now - ts);
        reactivesocket._outstandings -= 1;
        reactivesocket._stamp0 = now;
        return now;
    };

    var _observe = function _observe(rtt) {
        reactivesocket._median.insert(rtt);
    };

    // Wrapping Reactivesocket methods
    var underlyingRequest = reactivesocket.request.bind(reactivesocket);

    reactivesocket.request = function request(req) {
        var stream = underlyingRequest(req);
        var start = _incr();
        stream.on('response', function _onResponse() {
            var now = CLOCK.now();
            var elapsed = now - start;
            _observe(elapsed);
        });
        stream.on('terminate', function onRequestTerminate() {
            _decr(start);
        });
        return stream;
    };

    reactivesocket.getPredictedLatency = function getPredictedLatency() {
        var now = CLOCK.now();
        var elapsed = now - reactivesocket._stamp;

        var weight;
        var prediction = reactivesocket._median.estimate();

        if (prediction === 0) {
            if (reactivesocket._outstandings === 0) {
                weight = 0; // first request
            } else {
                // subsequent requests while we don't have any history
                weight = STARTUP_PENALTY + reactivesocket._outstandings;
            }
        } else if (reactivesocket._outstandings === 0
            && elapsed > reactivesocket._inactivityPeriodMs) {
            // if we did't see any data for a while, we decay the prediction by
            // inserting artificial low value into the median
            reactivesocket._median.insert(
                reactivesocket._median.estimate() * 0.8);
            reactivesocket._stamp = now;
            reactivesocket._stamp0 = now;
            weight = reactivesocket._median.estimate();
        } else {
            var predicted = prediction * reactivesocket._outstandings;
            var instant = _instantaneous(now);

            if (predicted < instant) { // NB: (0.0 < 0.0) == false
                // NB: _outstandings never equal 0 here
                weight = instant / reactivesocket._outstandings;
            } else {
                // we are under the predictions
                weight = prediction;
            }
        }

        return weight;
    };

    reactivesocket.getPending = function getPending() {
        return reactivesocket._outstandings;
    };

    return reactivesocket;
}

module.exports = WeightedSocket;
