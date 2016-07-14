'use strict';

var net = require('net');
var util = require('util');

var EventEmitter = require('events');

var _ = require('lodash');
var assert = require('assert-plus');
var bunyan = require('bunyan');

var Connection = require('./connection');

var LOG = require('../logger');

/**
 * A TCP based ReactiveSocket connection.
 * @param {Object} opts The options object
 * @param {Object} opts.connOpts The TCP connection options, the same options
 * that's passed to net.connect()
 * @param {Object} [opts.sockOpts] The TCP socket options, the same options
 * that's passed to net.Socket()
 * @param {Object} [opts.rsOpts] The RS connection options, same options as
 * passed to new Connection();
 * @param {Object} [opts.log=bunyan] Bunyan logger
 *
 * @returns {TcpConnection}
 */
function TcpConnection(opts) {
    EventEmitter.call(this);
    assert.object(opts, 'opts');
    assert.optionalObject(opts.log, 'opts.log');
    assert.optionalObject(opts.sockOpts, 'opts.sockOpts');
    assert.object(opts.connOpts, 'opts.connOpts');
    assert.optionalObject(opts.rsOpts, 'opts.rsOpts');

    var self = this;
    this._log = null;

    if (opts.log) {
        this._log = opts.log.child({
            component: 'rs-tcp-connection',
            level: process.env.LOG_LEVEL || bunyan.WARN
        });
    } else {
        this._log = LOG;
    }

    this._rsConnection = null;
    this._tcpConn = null;
    this._rsOpts = _.assign({
        log: self._log,
        transport: {
            framed: true
        },
        type: 'client'
    }, opts.rsOpts);

    this._closeListener = function _closeListener() {
        self._log.info('TcpConnection: got close event, reconnecting');

        self.emit('close');
        connect();
    };

    connect();

    function connect() {
        self._log.debug({opts: opts.connOpts}, 'Instantiating tcp connection');

        if (opts.sockOpts) {
            self._tcpConn = new net.Socket(opts.sockOpts);
            self._tcpConn.connect(opts.connOpts);
        } else {
            self._tcpConn = net.connect(opts.connOpts);
        }
        self._tcpConn.once('connect', function () {
            self._log.debug({rsOpts: self._rsOpts},
                            'TcpConnection: tcp connection ready');
            self._rsOpts.transport.stream = self._tcpConn;
            self._rsConnection = new Connection(self._rsOpts);
            self._rsConnection.once('ready', function () {
                self.emit('ready');
            });
        });
        self._tcpConn.on('close', self._closeListener);
        self._tcpConn.on('error', function (err) {
            self._log.warn({err: err}, 'TcpRSConnection: got Error');
        });
    }
}
util.inherits(TcpConnection, EventEmitter);

module.exports = TcpConnection;

/**
 * Close the reactivesocket connection
 * @returns {null}
 */
TcpConnection.prototype.close = function close() {
    var self = this;
    self._log.debug('closing connection');

    self._tcpConn.removeListener('close', self._closeListener);
    self._tcpConn.once('close', function () {
        self.emit('close');
    });

    self._tcpConn.end();
};

/**
 * Get the reactive socket connection
 * @returns {connection}
 */
TcpConnection.prototype.getConnection = function getConnection() {
    var self = this;
    return self._rsConnection;
};
