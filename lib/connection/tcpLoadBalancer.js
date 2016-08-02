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
 * @param {Number} [opts.size] The maximum number of connections to maintain in
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
    assert.optionalNumber(opts.size, 'opts.size');
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

    this._size = opts.size || 3;

    var numHosts = _.keys(opts.hosts).length;

    if (numHosts < self._size) {
        self._size = numHosts;
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

                if (!self._ready) {
                    self._ready = true;
                    self.emit('ready');
                }

                if (count === self._size) {
                    // all connections connected
                    self.emit('connected');
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
 * update the hosts in the free list, taking care to not duplicate any hosts
 * that are already in the connecting and connected states.  optionally
 * disconnect hosts that are no longer in the list
 * @param {array} hosts The set of updated hosts of this connection pool.
 *
 * @returns {null}
 */
TcpLoadBalancer.prototype.updateHosts = function updateHosts(hosts) {
    var self = this;
    self._log.info({hosts: hosts}, 'TcpLoadBalancer.updateHosts: entering');

    // hosts that don't currently exist in the pool
    var newHosts = _.difference(hosts, self._hosts);
    _.forEach(newHosts, function (h) {
        var connStr = h.host + ':' + h.port;
        self._connections.free[connStr] = h;
    });
    // hosts that need to be removed
    var deadHosts = _.differenceWith(self._hosts, hosts, _.isEqual);

    self._hosts = _.cloneDeep(hosts);

    // close connections no longer in the host list
    _.forEach(deadHosts, function (h) {
        var connStr = h.host + ':' + h.port;
        delete self._connections.free[connStr];

        if (self._connections.connecting[connStr]) {
            self._connections.connecting[connStr].close();
        } else if (self._connections.connected[connStr]) {
            self._connections.connected[connStr].close();
        }
    });
};


/// Privates


// Randomly connect to a new server
TcpLoadBalancer.prototype._connect = function _connect(cb) {
    var self = this;

    self._log.info('TcpLoadBalancer.connect: enteringt');

    cb = _.once(cb);

    if (_.keys(self._connections.free).length === 0) {
        self._log.warn('TcpLoadBalancer.connect: no more free ' +
                       'connections');
        return cb();
    }

    var connOpts = _.sample(self._connections.free);
    var connStr = connOpts.host + ':' + connOpts.port;
    self._log.info({connOpts: connOpts},
                   'TcpLoadBalancer.connect: entering');

    // remove the connection from the free list so we don't pick it again
    // for the next connection
    delete self._connections.free[connStr];
    self._connections.connecting[connStr] = new TcpConnection({
        connOpts: connOpts,
        rsOpts: self._rsOpts,
        log: self._log
    });

    self._connections.connecting[connStr].once('ready', function () {
        self._log.debug({connOpts: connOpts},
                        'TcpLoadBalancer: connection ready');
        self._connections.connected[connStr] =
            self._connections.connecting[connStr];
        delete self._connections.connecting[connStr];

        self.emit('connect', self._connections.connected[connStr]);
        return cb(null, connStr);
    });

    // on connection close we pick a new connection to connect to.
    self._connections.connecting[connStr].once('close', function () {
        self._log.info({connOpts: connOpts},
                       'TcpLoadBalancer: connection closed');
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
        self._connect(cb);
    });

    return null;
};
