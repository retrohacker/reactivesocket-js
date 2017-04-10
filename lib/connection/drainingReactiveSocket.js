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
 * @returns {ReactiveSocket}
 */

function DrainingReactiveSocket(reactivesocket) {
    reactivesocket._pendings = 0;
    reactivesocket._closedCb = null;

    var underlyingRequest = reactivesocket.request.bind(reactivesocket);
    var underlyingAvailability =
        reactivesocket.availability.bind(reactivesocket);
    var underlyingClose = reactivesocket.close.bind(reactivesocket);

    reactivesocket.request = function request(req) {
        reactivesocket._pendings++;
        var stream = underlyingRequest(req);
        stream.on('terminate', function _onRequestComplete() {
            reactivesocket._pendings -= 1;

            if (reactivesocket._closedCb && reactivesocket._pendings === 0) {
                LOG.debug('Draining actually closing ' + reactivesocket.name);
                reactivesocket.close(reactivesocket._closedCb);
            }
        });
        return stream;
    };

    reactivesocket.availability = function availability() {
        if (reactivesocket._closedCb) {
            return 0;
        } else {
            return underlyingAvailability();
        }
    };

    reactivesocket.close = function close(cb) {
        if (reactivesocket._pendings === 0) {
            underlyingClose(cb);
        } else {
            LOG.debug('Draining delay close on ' + reactivesocket.name);
            reactivesocket._closedCb = cb;
            setTimeout(function () {
                LOG.info('Draining timeout! Closing ' + reactivesocket.name);
                underlyingClose(cb);
            }, 30000);
        }
    };

    return reactivesocket;
}

module.exports = DrainingReactiveSocket;
