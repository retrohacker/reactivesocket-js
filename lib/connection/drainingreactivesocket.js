'use strict';

function DrainingReactiveSocket(reactivesocket) {
    reactivesocket._pendings = 0;
    reactivesocket._closedCb = null;

    var underlyingRequest = reactivesocket.request.bind(reactivesocket);
    var underlyingAvailability = reactivesocket.availability.bind(reactivesocket);
    var underlyingClose = reactivesocket.close.bind(reactivesocket);

    reactivesocket.request = function request(req) {
        reactivesocket._pendings++;
        var stream = underlyingRequest(req);
        stream.on('terminate', function _onRequestComplete() {
            reactivesocket._pendings -= 1;

            if (reactivesocket._closedCb && reactivesocket._pendings === 0) {
                console.log('Draining actually closing ' + reactivesocket.name);
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
            console.log('Draining delay close on ' + reactivesocket.name);
            reactivesocket._closedCb = cb;
        }
    };

    return reactivesocket;
}

module.exports = DrainingReactiveSocket;
