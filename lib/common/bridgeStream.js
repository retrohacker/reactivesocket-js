'use strict';

var _ = require('lodash');
var EventEmitter = require('events');
var util = require('util');

var events = [
    'response',
    'timeout',
    'setup-error',
    'application-error',
    'invalid-error',
    'reserved-error',
    'error',
    'terminate'
];

/**
 * @constructor
 * @param {Object} stream the inner stream we want
 * @returns {Object}
 */
function BridgeStream(stream) {
    EventEmitter.call(this);
    this._innerStream = stream;
    this._currentHandlers = {};

    var self = this;
    self.attach(self._innerStream);
}
util.inherits(BridgeStream, EventEmitter);

module.exports = BridgeStream;

BridgeStream.prototype.detach = function detach() {
    var self = this;
    // detach handlers
    _.forEach(self._currentHandlers, function (fn, name) {
        self._innerStream.removeListener(name, fn);
    });
};

BridgeStream.prototype.attach = function attach(stream) {
    var self = this;

    this._innerStream = stream;

    // overwrite methods
    bridgeMethods(self, self._innerStream);

    // attach new handlers
    this._currentHandlers = bridgeEvents(self._innerStream, self);
};


/// Private methods

// calling a method on `fromObject` will forward the call to `toObject`
function bridgeMethods(fromObject, toObject) {
    fromObject.cancel = toObject.cancel.bind(toObject);
    fromObject.getRequest = toObject.getRequest.bind(toObject);
    fromObject.getResponse = toObject.getResponse.bind(toObject);
    fromObject.getError = toObject.getError.bind(toObject);
}

// An event coming from `fromObject` will be propagated to `toObject`
function bridgeEvents(fromObject, toObject) {
    var eventHandlers = {};

    _.forEach(events, function (eventName) {
        var handler = function (e) {
            toObject.emit(eventName, e);
        };
        fromObject.on(eventName, handler);
        eventHandlers[eventName] = handler;
    });

    return eventHandlers;
}
