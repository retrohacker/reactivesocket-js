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
        this._size = numHosts;
    }

    this._ready = false;

    this._rsOpts = _.assign({
        log: self._log,
        transport: {
            framed: true
        },
        type: 'client'
    }, opts.rsOpts);

    this._connections = {};

    this._connections = {
        connected: {},
        connecting: {}
    };

    seedPool();

    this._strategy = opts.strategy || random;

    // seed the pool with connections
    function seedPool (cb) {
        for (var i = 0; i < self._size; i++) {
            connect(function () {
                if (!self._ready) {
                    self._ready = true;
                    self.emit('ready');
                }
            });
        }
    }

    // Randomly connect to a new server
    function connect(cb) {
        cb = _.once(cb);
        var connOpts = _.sample(opts.hosts);
        var connStr = connOpts.host + ':' + connOpts.port;

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

            return cb(null, connStr);
        });

        // on connection close we pick a new connection to connect to.
        self._connections.connecting[connStr].once('close', function () {
            delete self._connections.connecting[connStr];
            delete self._connections.connected[connStr];
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

    return self._strategy();
};

TcpConnectionPool.prototype.close = function close() {
    var self = this;

};
