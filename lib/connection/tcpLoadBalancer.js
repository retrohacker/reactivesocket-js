'use strict';

var util = require('util');

var EventEmitter = require('events');

var _ = require('lodash');
var assert = require('assert-plus');

var TcpConnection = require('./tcpConnection');

var LOG = require('../logger');
var EFFORT = 5;

/**
 * RS TCP based client side load balancer.
 *
 * @param {Object} opts Options object
 * @param {Object} [opts.log=bunyan] Bunyan logger
 * @param {Array} opts.hosts The set of hosts of this connection pool.
 * @param {Number} opts.size The maximum number of connections to maintain in
 * the pool.
 * @param {Object} [opts.rsOpts] The RS connection options, same options as
 * passed to new Connection();
 * @param {Function} [opts.strategy=random] The strategy used to choose a
 * connection.
 *
 * @emits connect when a new connection is made.
 * @emits ready the first time there is a connected connection in the load
 * balancer. This is emitted only once. Listen to this event if you'd like to
 * start making requests as soon as there's an available connection.
 * @emits connected the first time when there is a complete set of connected
 * connections. This is only emitted once. Listen to this event if you'd like
 * to start making requests as soon as the LB is full of connections.
 * @emits close when the pool is completely closed and devoid of any connected
 * connections.
 *
 * @returns {Pool}
 */
function TcpLoadBalancer(opts) {
    EventEmitter.call(this);
    assert.object(opts, 'opts');
    assert.array(opts.hosts, 'opts.hosts');
    assert.number(opts.size, 'opts.size');
    assert.optionalObject(opts.log, 'opts.log');
    assert.optionalFunc(opts.strategy, 'opts.strategy');

    var self = this;

    this._log = null;

    if (opts.log) {
        this._log = opts.log.child({
            component: 'rs-pool'
        });
    } else {
        this._log = LOG;
    }

    self._log.debug({opts: opts}, 'rs.Pool: new');

    this._size = opts.size;

    if (self._size <= 0) {
        throw new Error('opts.size must be greater than 0');
    }

    this._ready = false;
    this._connected = false;

    this._closed = false;

    this._connections = {
        connected: {},
        connecting: {},
        free: {} // 'ip:port': {}
    };

    // deep clone the hosts and copy them over to the free list
    // we can then use the free list to randomly pick a new connection later
    // on
    this._hosts = _.cloneDeep(opts.hosts);

    _(self._hosts).forEach(function (h) {
        var connStr = h.host + ':' + h.port;
        self._connections.free[connStr] = h;
    });

    this._rsOpts = _.assign({
        log: self._log,
        transport: {
            framed: true
        },
        type: 'client'
    }, opts.rsOpts);

    // 'Power of 2 Choices'' strategy (use `availability` as the load function)
    // c.f. https://www.eecs.harvard.edu/~michaelm/postscripts/mythesis.pdf
    function p2c() {
        var availableConnections = _.values(self._connections.connected);
        var n = availableConnections.length;

        if (n === 0) {
            return null;
        }

        if (n === 1) {
            return availableConnections.connected[0].getConnection();
        }

        var conn1 = null;
        var conn2 = null;

        for (var e = 0; e < EFFORT; e++) {
            // i1, i2 are 2 *different* random numbers in [0, n]
            var i1 = Math.floor(Math.random() * n);
            var i2 = Math.floor(Math.random() * (n - 1));

            if (i2 >= i1) {
                i2++;
            }

            conn1 = availableConnections[i1].getConnection();
            conn2 = availableConnections[i2].getConnection();

            if (conn1 && conn1.availability() > 0
                && conn2 && conn2.availability() > 0) {
                break;
            }
        }
        if (!conn2) {
            return conn1;
        } else if (conn1 && conn1.availability() > conn2.availability()) {
            return conn1;
        } else {
            return conn2;
        }
    }

    this._strategy = opts.strategy || p2c;

    // seed the pool with connections
    for (var i = 0; i < self._size; i++) {
        self._connect();
    }
}
util.inherits(TcpLoadBalancer, EventEmitter);

module.exports = TcpLoadBalancer;

/**
 * Get a connection from the pool
 * @returns {TcpRSConnection} returns a connection, null if there are currently
 * no connections.
 */
TcpLoadBalancer.prototype.getConnection = function getConnection() {
    var self = this;

    return self._strategy();
};

/**
 * close the connection pool and all associated connections
 * @returns {null}
 */
TcpLoadBalancer.prototype.close = function close() {
    var self = this;
    self._log.info('TcpLoadBalancer: closing');

    self._closed = true;

    _(self._connections.connected).forEach(function (c) {
        if (typeof (c) === TcpConnection) {
            c.close();
        }
    });
    _(self._connections.connecting).forEach(function (c) {
        if (typeof (c) === TcpConnection) {
            c.close();
        }
    });
};

/**
 * Update the hosts in the free list, taking care to not duplicate any hosts
 * that are already in the connecting and connected states.  optionally
 * disconnect hosts that are no longer in the list
 * @param {array} hosts The set of updated hosts of this connection pool.
 *
 * @returns {null}
 */
TcpLoadBalancer.prototype.updateHosts = function updateHosts(hosts) {
    var self = this;
    self._log.info({hosts: hosts}, 'TcpLoadBalancer.updateHosts: entering');

    // cache the old host list locally
    var prevHosts = _.cloneDeep(self._hosts);
    // update the current host list.
    self._hosts = _.cloneDeep(hosts);

    // add hosts that don't currently exist in the pool
    var newHosts = _.differenceWith(hosts, prevHosts, _.isEqual);
    _.forEach(newHosts, function (h) {
        var connStr = h.host + ':' + h.port;
        self._connections.free[connStr] = h;
    });

    // delete hosts that are no longer in discovery
    var deadHosts = _.differenceWith(prevHosts, hosts, _.isEqual);
    _.forEach(deadHosts, function (h) {
        var connStr = h.host + ':' + h.port;
        delete self._connections.free[connStr];
    });

    // close hosts that are no longer in discovery. This should automatically
    // ensure that a new connection is made from the fresh free list.
    _.forEach(deadHosts, function (h) {
        var connStr = h.host + ':' + h.port;

        if (self._connections.connecting[connStr]) {
            self._connections.connecting[connStr].close();
        } else if (self._connections.connected[connStr]) {
            self._connections.connected[connStr].close();
        }
    });

    // Now we check to see if we should create more connections. This is
    // because connections could be < pool size, due to not having enough free
    // hosts the last time updateHosts was invoked. If we now have more free
    // hosts, then we should attempt to max out the configured pool size.
    var activeConnCount = self._getActiveConnCount();
    var additionalConnCount = self._size - activeConnCount;

    if (additionalConnCount <= 0) {
        return;
    }
    // we need to spawn the minimum of either freeCount or additionalConnCount
    additionalConnCount = Math.min(additionalConnCount,
                                   _.keys(self._connections.free).length);

    for (var i = 0; i < additionalConnCount; i++) {
        self._connect();
    }
};


/// Privates


// Randomly connect to a new server
TcpLoadBalancer.prototype._connect = function _connect(cb) {
    var self = this;

    self._log.info('TcpLoadBalancer.connect: entering');

    if (!cb) {
        cb = function () {};
    }
    cb = _.once(cb);

    // only try and reconnect if there are less active connections than the max
    // pool size
    var currActiveConnCount = self._getActiveConnCount();

    if (currActiveConnCount >= self._size) {
        self._log.warn({
            currActiveConnCount: currActiveConnCount,
            poolSize: self._size
        }, 'TcpLoadBalancer._connect: not creating new connection, there are' +
            ' already enough connections');
        return cb(new Error('not creating new connection'));
    }

    if (_.keys(self._connections.free).length === 0) {
        self._log.warn('TcpLoadBalancer._connect: no more free connections');
        return cb(new Error('no more free connections'));
    }

    var connOpts = _.sample(self._connections.free);
    var connStr = connOpts.host + ':' + connOpts.port;
    self._log.info({connOpts: connOpts}, 'TcpLoadBalancer.connect: connecting');

    // remove the connection from the free list so we don't pick it again
    // for the next connection
    delete self._connections.free[connStr];
    self._connections.connecting[connStr] = new TcpConnection({
        connOpts: connOpts,
        rsOpts: self._rsOpts,
        log: self._log
    });

    // on connection close we pick a new connection to connect to.
    self._connections.connecting[connStr].once('close', function () {
        self._log.info({connOpts: connOpts},
                       'TcpLoadBalancer._connect: connection closed');
        delete self._connections.connecting[connStr];
        delete self._connections.connected[connStr];
        // #55 if this host is in self._hosts, we want to add it back into the
        // free list.
        if (_.includes(self._hosts, connOpts)) {
            self._connections.free[connStr] = connOpts;
        }
        // don't reconnect if the pool is closed
        if (self._closed) {
            if (_.keys(self._connections.connecting).length === 0 &&
                _.keys(self._connections.connected).length === 0) {
                self.emit('close');
            }
            return;
        }
        // only try and reconnect if we haven't exceeded the pool size.
        if (self._getActiveConnCount() < self._size) {
            self._connect(cb);
        }
    });

    self._connections.connecting[connStr].once('ready', function () {
        self._log.debug({connOpts: connOpts},
                        'TcpLoadBalancer._connect: connection ready');
        self._connections.connected[connStr] =
            self._connections.connecting[connStr];
        delete self._connections.connecting[connStr];

        self.emit('connect', self._connections.connected[connStr]);
        // if we haven't yet emitted a ready event, now's the time
        if (!self._ready) {
            self._ready = true;
            setImmediate(function () {
                self._log.info('TcpLoadBalancer._connect: pool ready');
                self.emit('ready');
            });
        }
        // emit connected if we have the maximum number of connected
        // connections for the first time
        if (!self._connected) {
            if (_.keys(self._connections.connected).length === self._size) {
                self._connected = true;
                setImmediate(function () {
                    self._log.info('TcpLoadBalancer._connect: pool connected');
                    self.emit('connected');
                });
            }
        }
        self._log.info({connStr: connStr}, 'TcpLoadBalancer._connect: exiting');
        return cb(null, connStr);
    });

    return null;
};

// Return a count of the "active" connections in the pool. An "active"
// connection is one that is either in a connected or connecting state
TcpLoadBalancer.prototype._getActiveConnCount = function _getActiveConnCount() {
    var self = this;

    var activeConnCount = _.keys(self._connections.connected).length +
        _.keys(self._connections.connecting).length;
    self._log.debug({activeConnCount: activeConnCount},
                    'TcpLoadBalancer._getActiveConnCount: returning');

    return activeConnCount;
};

