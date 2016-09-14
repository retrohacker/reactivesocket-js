'use strict';

var util = require('util');
var EventEmitter = require('events');

var assert = require('assert-plus');
var _ = require('lodash');

var getSemaphore = require('../common/getSemaphore');
var DrainingReactiveSocket = require('./drainingreactivesocket');
var WeightedSocket = require('./weightedsocket');

var EMPTY_LB_ERROR = new Error('Empty Loadbalancer');
var FAILING_STREAM = {
    on: function (what, f) {
        if (what === 'error' || what === 'terminate') {
            setImmediate(function () {
                f(EMPTY_LB_ERROR);
            });
        }
        return FAILING_STREAM;
    }
}
var FAILING_SOCKET = {
    request: function (req) {
        return FAILING_STREAM;
    },
    availability: function () {
        return 0.0;
    }
};

/**
 * ReactiveSocket client side load balancer.
 *
 * @param {Object} opts Options object
 * @param {Object} [opts.log=bunyan] Bunyan logger
 * @param {Object} opts.factorySource EventEmitter emiting 'add' and 'remove'
 *        events with added/removed ReactiveSocketFactory
 * @param {Number} opts.initialAperture The initial number of connections to
 *        maintain in the pool.
 * @param {Number} opts.minAperture The min number of connections to maintain
 *        in the pool.
 * @param {Number} opts.maxAperture The max number of connections to maintain
 *        in the pool.
 * @param {Number} opts.refreshPeriodMs The period at which the worst
 *        connection is recycled.
 *
 * @emits connect when a new connection is made.
 * @emits ready the first time there is a connected connection in the load
 * balancer. This is emitted only once. Listen to this event if you'd like to
 * start making requests as soon as there's an available connection.
 *
 * @returns {Pool}
 */

function LoadBalancer(opts) {
    var self = this;
    EventEmitter.call(this);
    this._factories = [];
    this._sockets = [];
    this._lastApertureRefresh = Date.now();
    this._pendings = 0;
    this._outstandings = 0;
    this._ready = false;

    this._targetAperture = opts.initialAperture || 5;
    this._minAperture = opts.minAperture || 3;
    this._maxAperture = opts.maxAperture || 100;
    this._refreshPeriodMs = opts.refreshPeriodMs || 5 * 60 * 1000;

    opts.factorySource.on('add', function (factory) {
        self._addFactory(factory);
    });
    opts.factorySource.on('remove', function (factory) {
        self._removeFactory(factory);
    });

    this._refreshTimer = setInterval(function refreshConnection() {
        if (self._sockets.length > 0) {
            var socket = _.sample(self._sockets); //self.slowest()
            console.log('closing socket ' + socket.name);
            socket.close();
        }
    }, self._refreshPeriodMs)
}

util.inherits(LoadBalancer, EventEmitter);
module.exports = LoadBalancer;


/// API

/**
 * Send a request-response frame.
 * @param {Object} req The request-response object.
 * @param {String} [req.data=null] The data string.
 * @param {String} [req.metaData=null] The metaData string.
 *
 * @returns {RSStream} Which fires a 'response' event when a response is
 * received
 */
LoadBalancer.prototype.request = function request(req) {
    var self = this;
    var socket = self._selectSocket();
    // console.log('sending request ' + JSON.stringify(req));
    self._outstandings += 1;
    var stream = socket.request(req);
    stream.on('terminate', function () {
        self._outstandings -= 1;
    });

    return stream;
}

/**
 * Return the current availability.
 * The Loadbalancer availability is the arithmetic average of its underlying
 * reactivesockets.
 *
 * @returns {availability} a number between 0.0 and 1.0 (higher is better)
 */
LoadBalancer.prototype.availability = function availability() {
    var self = this;
    var a = 0.0;
    _.forEach(self._sockets, function (socket) {
        a += socket.availability();
    });
    a = a / self._sockets.length;
    return a;
}

/**
 * Close the ReactiveSocket, which close the underlying ReactiveSockets.
 * @param {Function} cb Call-back called when the LoadBalancer is closed.
 *
 * @returns {null}
 */
LoadBalancer.prototype.close = function close(cb) {
    var self = this;
    clearInterval(self._refreshTimer);
    var semaphore = getSemaphore(self._sockets.length, function () {
        cb();
        self.emit('close', self);
    });
    _.forEach(self._sockets, function (socket) {
        socket.close(function () {
            semaphore.latch();
        })
    });
}

/// Privates

// Update the aperture target and consequently add/remove socket to match the
// target.
LoadBalancer.prototype._refreshSockets = function _refreshSockets() {
    var self = this;
    self._updateAperture();

    var n = self._sockets.length;
    if (n < self._targetAperture) {
        var factory = self._selectFactory();
        if (factory) {
            self._addSocket(factory);
        }
    } else if (n > self._targetAperture) {
        // TODO: select slowest
        var socket = _.sample(self._sockets);
        if (socket) {
            self._removeSocket(socket);
        }
    }
}

LoadBalancer.prototype._updateAperture = function _updateAperture() {
    var self = this;
    var avgOutstandings = 0;
    if (self._sockets.length !== 0) {
        avgOutstandings = self._outstandings / self._sockets.length;
    }

    var now = Date.now();
    var underRateLimit = now - self._lastApertureRefresh > 5000;
    var oldAperture = self._targetAperture;
    if (avgOutstandings < 1.0 && underRateLimit) {
        self._targetAperture = Math.max(
            self._minAperture, self._targetAperture - 1);
        console.log('Decreasing aperture from ' + oldAperture + ' to ' + self._targetAperture);
        self._lastApertureRefresh = now;
    } else if (avgOutstandings > 2.0 && underRateLimit) {
        self._targetAperture = Math.min(
            self._maxAperture, self._targetAperture + 1);
        console.log('Increasing aperture from ' + oldAperture + ' to ' + self._targetAperture);
        self._lastApertureRefresh = now;
    }
}

LoadBalancer.prototype._selectSocket = function _selectSocket() {
    var self = this;
    console.log("Select");
    _.forEach(self._sockets, function (wsocket) {
        var n = wsocket.getPending();
        var latency = wsocket.getPredictedLatency();
        console.log(wsocket.name + ' (n:' + n + ', lat:' + latency + '):' + Array(1 + n).join("#"));
    });
    var socket = p2c(self._sockets, function (wsocket) {
        var latency = wsocket.getPredictedLatency();
        var outstandings = wsocket.getPending();
        return wsocket.availability() / (1.0 + latency * (outstandings + 1));
    });
    _.forEach(self._sockets, function (wsocket) {
        if (socket === wsocket) {
            console.log('picking ' + wsocket.name);
        }
    })

    if (!socket) {
        return FAILING_SOCKET;
    } else {
        return socket;
    }
}

LoadBalancer.prototype._addSocket = function _addSocket(factory) {
    var self = this;
    self._pendings += 1;
    self.emit('connect', factory);
    console.log('Adding new socket from factory ' + factory.name);
    factory.apply().on('reactivesocket', function (socket, err) {
        var drainingSocket = new DrainingReactiveSocket(socket);
        var weightedSocket = new WeightedSocket(drainingSocket);
        socket.on('close', function () {
            self._removeSocket(weightedSocket);
        });
        weightedSocket.factory = factory;
        weightedSocket.name = factory.name;
        self._sockets.push(weightedSocket);
        console.log('Adding new socket ' + factory.name);
        self._pendings -= 1;
        if (!self._ready) {
            console.log('LoadBalancer ready!');
            self.emit('ready', self);
            self._ready = true;
        }
    });
}

LoadBalancer.prototype._removeSocket = function _removeSocket(socket) {
    var self = this;
    var i = self._sockets.indexOf(socket);
    if (i >= 0) {
        self._sockets.splice(i, 1);
    }
    self._addFactory(socket.factory);
}

/**
  * @returns {ReactiveSocketFactory} or null if it can't find one.
 */
LoadBalancer.prototype._selectFactory = function _selectFactory() {
    var self = this;
    var factory = p2c(self._factories, function (f) { return f.availability() });
    var i = self._factories.indexOf(factory);
    if (i >= 0) {
        self._factories.splice(i, 1);
    } else {
        console.err('ERR can\'t find factory');
    }
    return factory;
}

LoadBalancer.prototype._addFactory = function _addFactory(factory) {
    var self = this;
    self._factories.push(factory);
    self._refreshSockets();
}

LoadBalancer.prototype._removeFactory = function _removeFactory(factory) {
    var self = this;
    var i = self._factories.indexOf(factory);
    if (i >= 0) {
        self._factories.splice(i, 1);
    }
    var socketToClose = self._sockets.filter(function (socket) {
        return socket.factory === factory;
    });
    _.forEach(socketToClose, function (socket) {
        socket.close();
    });
    self._refreshSockets();
}

function p2c(availableObjects, loadOf) {
    assert.arrayOfObject(availableObjects, 'availableObjects');
    assert.func(loadOf, 'loadOf');

    var n = availableObjects.length;

    if (n === 0) {
        return null;
    }

    if (n === 1) {
        return availableObjects[0];
    }

    var obj1 = null;
    var obj2 = null;

    for (var e = 0; e < 5; e++) {
        // i1, i2 are 2 *different* random numbers in [0, n]
        var i1 = Math.floor(Math.random() * n);
        var i2 = Math.floor(Math.random() * (n - 1));

        if (i2 >= i1) {
            i2++;
        }

        obj1 = availableObjects[i1];
        obj2 = availableObjects[i2];

        if (obj1 && obj1.availability() > 0
            && obj2 && obj2.availability() > 0) {
            break;
        }
    }

    if (!obj2) {
        return obj1;
    } else if (obj1 && loadOf(obj1) > loadOf(obj2)) {
        return obj1;
    } else {
        return obj2;
    }
}
