'use strict';

var assert = require('assert-plus');
var DISABLE_RECORDER = require('metrix').recorder.DISABLE;
var BridgeStream = require('../common/bridgeStream');
var Ewma = require('../common/ewma');

/**
 * ReEnqueueFilter
 * This re-enqueue requests that have been rejected by the server.
 * It only does that on idempotent requests (rejected by the server or not
 * transmitted to the server)
 *
 * The filter also compute a moving average of the re-enqueue rate and stop
 * re-enqueuing if this rate crosses a treshold (default 5%) to avoid
 * overwhelming the server with re-enqueue requests (problem also infamously
 * known as retry storm).
 *
 * @param {Object} reactivesocket the underlying ReactiveSocket
 * @param {Object} _opts the metrix recorder
 * @returns {ReactiveSocket}
 */
function ReEnqueueFilter(reactivesocket, _opts) {
    assert.optionalObject(_opts, 'opts');
    var opts = _opts || {};
    assert.optionalNumber(opts.maxReEnqueue, 'opts.maxReEnqueue');
    assert.optionalNumber(opts.maxReEnqueue, 'opts.maxReEnqueueRate');
    assert.optionalObject(opts.recorder, 'opts.recorder');

    var recorder = opts.recorder || DISABLE_RECORDER;
    // Default retries is 3
    var maxReEqueue = opts.maxReEnqueue || 3;
    // we disable retries when we reach 5% retry rate
    var maxReEnqueueRate = opts.maxReEnqueueRate || 5 / 100;
    var underlyingRequest = reactivesocket.request.bind(reactivesocket);

    // This EWMA moving average represent the rate of reEnqueue
    // 0.0 being no reEqueue
    // 0.5 50% of requests are reEqueued
    // 1.0 100% of requests are reEqueued
    reactivesocket._reenqueueRate = new Ewma(50, 0.0);

    reactivesocket._reenqueueFilterMetrics = {
        reEnqueues: recorder.counter('reEnqueues'),
        maxReEnqueues: recorder.counter('maxReEnqueues')
    };

    reactivesocket.request = function request(req) {
        // Note that there's a race here, if the innerStream emit an event
        // before it is bridged, this event is lost.
        var innerStream = underlyingRequest(req);
        var outterStream = new BridgeStream(innerStream);
        var n = 1;

        var updateFn = function (res) {
            reactivesocket._reenqueueRate.insert(0.0);
        };
        innerStream.on('response', updateFn);

        function hookRetry(stream, retryFn) {
            stream.on('cancelled-error', function (err) {
                retryFn('cancelled-error', err);
            });
            stream.on('rejected-error', function (err) {
                retryFn('rejected-error', err);
            });
            stream.on('connection-error', function (err) {
                retryFn('connection-error', err);
            });
        }

        function retry(name, err) {
            innerStream.removeListener('response', updateFn);
            var max = maxReEqueue;
            var reEnqueueRate = reactivesocket._reenqueueRate.value();

            if (reEnqueueRate > 0) {
                max = Math.min(maxReEqueue, maxReEnqueueRate / reEnqueueRate);
            }

            if (n < max) {
                // Compute moving average of re-enqueue rate
                reactivesocket._reenqueueRate.insert(1.0);

                outterStream.detach();
                var retryStream = underlyingRequest(req);
                hookRetry(retryStream, retry);
                outterStream.attach(retryStream);
                reactivesocket._reenqueueFilterMetrics.reEnqueues.incr();
            } else {
                outterStream.emit(name, err);
                reactivesocket._reenqueueFilterMetrics.maxReEnqueues.incr();
            }

            n++;
        }

        hookRetry(innerStream, retry);

        return outterStream;
    };

    return reactivesocket;
}

module.exports = ReEnqueueFilter;
