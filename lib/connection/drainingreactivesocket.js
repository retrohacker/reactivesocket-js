'use strict';

function DrainingReactiveSocket(reactivesocket) {
    this._underlying = reactivesocket;
    this._outstandings = 0;
    this._closedCb = null;
}

module.exports = DrainingReactiveSocket;

DrainingReactiveSocket.prototype.request = function request(req) {
    var self = this;
    self._outstandings++;
    var stream = self._underlying.request(req);
    stream.on('terminate', function _onRequestComplete() {
        self._outstandings -= 1;

        if (self._closedCb && self._outstandings === 0) {
            console.log('Draining actually closing ' + self._underlying.name);
            self._underlying.close(self._closedCb);
        }
    });
    return stream;
};

DrainingReactiveSocket.prototype.availability = function availability() {
    var self = this;

    if (self._closedCb) {
        return 0;
    } else {
        return self._underlying.availability();
    }
};

DrainingReactiveSocket.prototype.close = function close(cb) {
    var self = this;

    if (self._outstandings === 0) {
        self._underlying.close(cb);
    } else {
        console.log('Draining delay close on ' + self._underlying.name);
        self._closedCb = cb;
    }
};
