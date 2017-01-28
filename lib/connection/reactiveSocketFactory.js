'use strict';

var _ = require('lodash');
var net = require('net');
var util = require('util');
var EventEmitter = require('events');

var LOG = require('../logger');
var ReactiveSocket = require('./reactiveSocket');

function DEFAULT_CONNECTOR(port, host, cb) {
    return net.connect(port, host, cb);
}

var DEFAULT_OPTIONS = {
    transport: {
        framed: true
    },
    type: 'client',
    metadataEncoding: 'utf-8',
    dataEncoding: 'utf-8'
};

function ReactiveSocketFactory(opts) {
    this._port = opts.port;
    this._host = opts.host;
    this._connector = opts.connector || DEFAULT_CONNECTOR;
    this._log = opts.log || LOG;
    this._rsOptions = {};
    _.assignWith(this._rsOptions, DEFAULT_OPTIONS);
    _.assignWith(this._rsOptions, opts);
    EventEmitter.call(this);
}

util.inherits(ReactiveSocketFactory, EventEmitter);

module.exports = ReactiveSocketFactory;

/// API

ReactiveSocketFactory.prototype.build = function build(req) {
    var self = this;
    var res = new EventEmitter();

    self._log.debug('Connecting to ' + self._port + ':' + self._host);
    var client = self._connector(self._port, self._host, function () {
        self._log.debug('Connection to '
            + self._port + ':' + self._host + ' established!');
        self._rsOptions.transport.stream = client;
        var rs = new ReactiveSocket(self._rsOptions);
        res.emit('reactivesocket', rs);
    });
    client.on('error', function (err) {
        self._log.info('Connection to '
            + self._port + ':' + self._host + ' failed!');
        res.emit('error', err);
    });
    return res;
};

ReactiveSocketFactory.prototype.availability = function availability() {
    return 1.0;
};

ReactiveSocketFactory.prototype.name = function name() {
    var self = this;
    return self._host + ':' + self._port;
};
