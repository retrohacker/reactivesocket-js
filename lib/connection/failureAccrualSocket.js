'use strict';

var metrix = require('metrix');
var Ewma = require('../common/ewma');

var EPSILON = 1e-4;

/**
 * FailureAccrualSocket is a ReactiveSocket which update its availability based
 * on running success rate (using a sliding window defined by the half-life).
 *
 * @param {Object} reactivesocket the underlying ReactiveSocket
 * @param {Number} _halfLifeMs the underlying duration of the window in ms
 * @param {Object} _clock the clock object used to read time
 * @param {Object} _recorder the metrics recorder
 * @returns {ReactiveSocket}
 */
function FailureAccrualSocket(reactivesocket, _halfLifeMs, _clock, _recorder) {
    var clock = _clock || Date;
    var halfLifeMs = _halfLifeMs || 30 * 1000;

    reactivesocket._failureAccrualClock = clock;
    reactivesocket._failureAccrualStamp = Date.now();
    reactivesocket._failureAccrualWindow = halfLifeMs / Math.log(2);
    reactivesocket._failureAccrualEwma = new Ewma(halfLifeMs, 1.0, clock);

    var recorder = _recorder || metrix.config.DISABLE.recorder;
    reactivesocket._failureAccrualAvailabilityMetrics =
        recorder.histogram('failureAccrualAvailability');

    var underlyingRequest = reactivesocket.request.bind(reactivesocket);
    var underlyingAvailability =
        reactivesocket.availability.bind(reactivesocket);

    reactivesocket.request = function request(req) {
        var stream = underlyingRequest(req);
        var responseReceived = false;
        var terminateReceived = false;

        // insert 1.0 in the success rate ewma moving average
        stream.on('response', function onResponse() {
            if (!terminateReceived) {
                responseReceived = true;
                reactivesocket._failureAccrualEwma.insert(1.0);
            }
        });

        // insert 0.0 in the success rate ewma moving average
        stream.on('terminate', function onNonResponse() {
            if (!responseReceived) {
                terminateReceived = true;
                reactivesocket._failureAccrualEwma.insert(0.0);
            }
        });

        return stream;
    };

    reactivesocket.availability = function availability() {
        var e = reactivesocket._failureAccrualEwma.value();
        var elapsed = reactivesocket._failureAccrualClock.now()
            - reactivesocket._failureAccrualStamp;

        if (elapsed > reactivesocket._failureAccrualWindow) {
            // If the window is expired artificially increase the availability
            var a = Math.min(1.0, e + 0.5);
            reactivesocket._failureAccrualEwma.reset(a);
        }

        if (e < EPSILON) {
            e = 0.0;
        } else if (1.0 - EPSILON < e) {
            e = 1.0;
        }

        reactivesocket._failureAccrualAvailabilityMetrics.add(e);
        return e * underlyingAvailability();
    };

    return reactivesocket;
}

module.exports = FailureAccrualSocket;
