'use strict';

var util = require('util');

var EventEmitter = require('events');

var _ = require('lodash');
var assert = require('assert-plus');
var bunyan = require('bunyan');

var TcpConnection = require('./tcpConnection');

var LOG = require('../logger');

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
 * @emits ready when there is at least one connection in the pool.
 * @emits connected when the pool is fully connected.
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
            component: 'rs-pool',
            level: process.env.LOG_LEVEL || bunyan.WARN
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

    this._closed = false;

    this._connections = {
        connected: {},
        connecting: {},
        free: {}
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


    seedPool();

    this._strategy = opts.strategy || random;

    // seed the pool with connections
    function seedPool (cb) {
        var count = 0;

        for (var i = 0; i < self._size; i++) {
            self._connect(function () {
                count++;

                // TODO: these currently lie -- if there are no hosts to
                // connect to, we will still emit both ready and connected
                if (!self._ready) {
                    self._ready = true;
                    setImmediate(function () {
                        self.emit('ready');
                    });
                }

                if (count === self._size) {
                    // all connections connected
                    setImmediate(function () {
                        self.emit('connected');
                    });
                }
            });
        }
    }

    // random pick a connected server
    function random() {
        var connection = _.sample(self._connections.connected);

        if (connection) {
            return connection.getConnection();
        }
        return null;
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

    // add hosts that don't currently exist in the pool
    var newHosts = _.differenceWith(hosts, self._hosts, _.isEqual);
    _.forEach(newHosts, function (h) {
        var connStr = h.host + ':' + h.port;
        self._connections.free[connStr] = h;
    });

    // delete hosts that are no longer in discovery
    var deadHosts = _.differenceWith(self._hosts, hosts, _.isEqual);
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

    // update host list
    self._hosts = _.cloneDeep(hosts);

    // Now we check to see if we should create more connections. This is
    // because conenctions could be < pool size, due to not having enough free
    // hosts the last time updateHosts was invoked. If we now have more free
    // hosts, then we should attempt to max out the configured pool size.
    var activeConnCount = self._getActiveConnCount();
    var additionalConnCount = self._size - activeConnCount;

    if (additionalConnCount <= 0) {
        return;
    }
    // we need to spawn the minimum of either freeCount or additionalConnCount
    var freeCount = _.keys(self._connections.free).length;

    if (freeCount < additionalConnCount) {
        additionalConnCount = freeCount;
    }

    for (var i = 0; i < freeCount; i++) {
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
        return cb();
    }

    // bug here -- if we get more connections in the future but there are no
    // current connections, then we won't be connecting to the maximum pool size
    if (_.keys(self._connections.free).length === 0) {
        self._log.warn('TcpLoadBalancer._connect: no more free connections');
        return cb();
    }

    var connOpts = _.sample(self._connections.free);
    var connStr = connOpts.host + ':' + connOpts.port;
    self._log.info({connOpts: connOpts}, 'TcpLoadBalancer.connect: entering');

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
