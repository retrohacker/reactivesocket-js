'use strict';

var LOG = require('../logger');

/**
 * DrainingReactiveSocket is a ReactiveSocket which only close itself when
 * there's no more outstanding message.
 *
 * This is a function which override the method of the underlying
 * ReactiveSocket object.
 *
 * @param {Object} reactivesocket the underlying ReactiveSocket
 * @param {Object} _recorder the metrix recorder
 * @param {Number} closeTimeoutMs time after which the underlying socket will
 *      be closed even if there is an outstanding message
 * @returns {ReactiveSocket}
 */
function DrainingReactiveSocket(reactivesocket, _recorder, _closeTimeoutMs) {
    reactivesocket._drainingPendings = 0;
    reactivesocket._drainingClosedCb = null;
    var closeTimeoutMs = _closeTimeoutMs || 30000;

    reactivesocket._drainingOutstandingsMetrics = null;

    var underlyingRequest = reactivesocket.request.bind(reactivesocket);
    var underlyingAvailability =
        reactivesocket.availability.bind(reactivesocket);
    var underlyingClose = reactivesocket.close.bind(reactivesocket);

    reactivesocket.request = function request(req) {
        reactivesocket._drainingPendings++;
        var stream = underlyingRequest(req);
        stream.on('terminate', function _onRequestComplete() {
            reactivesocket._drainingPendings -= 1;

            if (reactivesocket._drainingClosedCb
                && reactivesocket._drainingPendings === 0) {
                LOG.debug('Draining actually closing ' + reactivesocket.name);
                reactivesocket.close(reactivesocket._drainingClosedCb);
                clearTimeout(reactivesocket._drainingTimerId);
            }
        });
        return stream;
    };

    reactivesocket.availability = function availability() {
        if (reactivesocket._drainingClosedCb) {
            return 0;
        } else {
            return underlyingAvailability();
        }
    };

    reactivesocket.close = function close(cb) {
        if (reactivesocket._drainingPendings === 0) {
            underlyingClose(cb);
        } else {
            LOG.debug('Draining delay close on ' + reactivesocket.name);
            reactivesocket._drainingClosedCb = cb;
            reactivesocket._drainingTimerId = setTimeout(function () {
                LOG.info('Draining timeout! Closing ' + reactivesocket.name);
                reactivesocket._drainingClosedCb = null;
                underlyingClose(cb);
            }, closeTimeoutMs);
        }
    };

    return reactivesocket;
}

module.exports = DrainingReactiveSocket;
