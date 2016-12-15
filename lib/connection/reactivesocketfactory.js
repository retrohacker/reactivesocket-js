'use strict';

var _ = require('lodash');
var net = require('net');
var util = require('util');
var EventEmitter = require('events');

var ReactiveSocket = require('./reactivesocket');

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
    this._rsOptions = {};
    _.assignWith(this._rsOptions, DEFAULT_OPTIONS);
    _.assignWith(this._rsOptions, opts);
    EventEmitter.call(this);
}

util.inherits(ReactiveSocketFactory, EventEmitter);

module.exports = ReactiveSocketFactory;

/// API

ReactiveSocketFactory.prototype.apply = function apply(req) {
    var self = this;
    var res = new EventEmitter();

    var client = self._connector(self._port, self._host, function () {
        var options = _.cloneDeep(self._rsOptions);
        options.transport.stream = client;
        var rs = new ReactiveSocket(options);
        res.emit('reactivesocket', rs);
    });
    client.on('error', function (err) {
        res.emit('error', err);
    });
    return res;
};

ReactiveSocketFactory.prototype.availability = function availability() {
    return 1.0;
};

ReactiveSocketFactory.prototype.name = function name() {
    var self = this;
    return self._address;
};
