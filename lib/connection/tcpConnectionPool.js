'use strict';

var util = require('util');

var EventEmitter = require('events');

var _ = require('lodash');
var assert = require('assert-plus');
var bunyan = require('bunyan');

var TcpConnection = require('./tcpConnection');

var LOG = require('../logger');

/**
 * RS Connection Pool
 *
 * @param {Object} opts Options object
 * @param {Object} [opts.log=bunyan] Bunyan logger
 * @param {Object} opts.hosts The set of hosts of this connection pool. This
 * can and should be updated in real time as hosts change.
 * @param {Number} [opts.size] The maximum number of connections to maintain in
 * the pool.
 * @param {Object} [opts.rsOpts] The RS connection options, same options as
 * passed to new Connection();
 *
 * @emits connect when a new connection is made.
 * @emits ready when there is at least one connection in the pool.
 * @emits connected when the pool is fully connected.
 *
 * @returns {Pool}
 */
function TcpConnectionPool(opts) {
    EventEmitter.call(this);
    assert.object(opts, 'opts');
    assert.object(opts.hosts, 'opts.hosts');
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

    this._connections = {};

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
            connect(function () {
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

    // Randomly connect to a new server
    function connect(cb) {
        cb = _.once(cb);
        var connOpts = _.sample(self._connections.free);
        var connStr = connOpts.host + ':' + connOpts.port;
        self._log.info({connOpts: connOpts},
                       'TcpConnectionPool.connect: entering');

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
                            'TcpConnectionPool: connection ready');
            self._connections.connected[connStr] =
                self._connections.connecting[connStr];
            delete self._connections.connecting[connStr];

            self.emit('connect', self._connections.connected[connStr]);
            return cb(null, connStr);
        });

        // on connection close we pick a new connection to connect to.
        self._connections.connecting[connStr].once('close', function () {
            self._log.info({connOpts: connOpts},
                           'TcpConnectionPool: connection closed');
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
            connect(cb);
        });
    }

    // random pick a connected server
    function random() {
        return _.sample(self._connections.connected).getConnection();
    }
}
util.inherits(TcpConnectionPool, EventEmitter);

module.exports = TcpConnectionPool;

TcpConnectionPool.prototype.getConnection = function getConnection() {
    var self = this;

    // TODO: what if there is no connection?
    return self._strategy();
};

TcpConnectionPool.prototype.close = function close() {
    var self = this;
    self._log.info('TcpConnectionPool: closing');

    self._closed = true;

    _(self._connections.connected).forEach(function (c) {
        if (typeof (c) === TcpConnectionPool) {
            c.close();
        }
    });
    _(self._connections.connecting).forEach(function (c) {
        if (typeof (c) === TcpConnectionPool) {
            c.close();
        }
    });
};

TcpConnectionPool.prototype.updateHosts = function updateHosts() {
    // update the hosts in the free list, taking care to not duplicate any
    // hosts that are already in the connecting and connected states.
    // optionally disconnect hosts that are no longer in the list
};
