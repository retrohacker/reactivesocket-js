'use strict';

var util = require('util');

var EventEmitter = require('events');

var _ = require('lodash');
var assert = require('assert-plus');

var FramingStream = require('../streams/framingStream');
var ParseStream = require('../streams/parseStream');
var RSStream = require('./stream');
var SerializeStream = require('../streams/serializeStream');

var CONSTANTS = require('../protocol/constants');
var DISABLE_RECORDER = require('metrix').recorder.DISABLE;
var ERROR_CODES = CONSTANTS.ERROR_CODES;
var FLAGS = CONSTANTS.FLAGS;
var LOG = require('../logger');
var TYPES = CONSTANTS.TYPES;

/**
 * Connection
 *
 * @param {Object} opts Options object
 * @param {Object} [opts.log=bunyan] Bunyan logger
 * @param {Object} [opts.transport.stream] Underlying transport stream
 * @param {Object} [opts.transport.framed=false] Whether the transport needs to
 * be framed. Defaults to false
 * @param {Boolean} opts.type Type of connection, one of 'client' or 'server'
 * @param {Number} [opts.keepalive=1000] Keep alive interval
 * @param {Number} [opts.maxLifetime=10000] maxLifetime interval.
 * @param {Number} [opts.requestTimeoutMs=30000] request timeout in millisecond.
 * @param {String} [metadataEncoding=utf8] metadata encoding. Only set for
 * client conns.
 * @param {String} [dataEncoding=utf8] data encoding. Only set for client conns.
 * @param {Boolean} [opts.lease] Whether lease is supported
 * @param {Boolean} [opts.strict] Whether connection is in strict mode
 * @param {Object} [opts.recorder] Recorder used for collecting metrics
 *
 * @returns {Connection}
 * @constructor
 * @emits ready When the connection is ready to be used
 * @emits error If there's an unrecoverable error with the connection
 * @emits request If there's a new inbound request on this connection
 * @emits close If this connection is closed
 * @emits setup If there is a new setup frame on this connection
 */
function Connection(opts) {
    EventEmitter.call(this);
    assert.object(opts, 'opts');
    assert.optionalObject(opts.log, 'opts.log');
    assert.object(opts.transport, 'opts.transport');
    assert.string(opts.type, 'opts.type');

    if (opts.type !== 'client' && opts.type !== 'server') {
        throw new Error('Connection must be of type client or server');
    }
    assert.object(opts.transport.stream, 'opts.transport.stream');
    assert.optionalBool(opts.lease, 'opts.lease');
    assert.optionalBool(opts.strict, 'opts.strict');

    // Client side specific settings
    assert.optionalNumber(opts.keepalive, 'opts.keepalive');
    assert.optionalNumber(opts.maxLifetime, 'opts.maxLifetime');
    // client must set encoding
    if (opts.type === 'client') {
        assert.optionalString(opts.metadataEncoding, 'opts.metadataEncoding');
        assert.optionalString(opts.dataEncoding, 'opts.dataEncoding');
        // TODO: right now we just assume node can handle whatever encoding you
        // pass in. Need someway to plugin an encoding engine
        this._metadataEncoding = opts.metadataEncoding || 'utf8';
        this._dataEncoding = opts.dataEncoding || 'utf8';
    }
    assert.optionalString(opts.setupMetadata, 'opts.setupMetadata');
    assert.optionalString(opts.setupData, 'opts.setupData');
    assert.optionalObject(opts.recorder, 'opts.recorder');

    var self = this;
    this._recorder = (opts.recorder || DISABLE_RECORDER).scope('connection');
    this._metrics = {
        close: self._recorder.counter('close'),
        requestCounter: self._recorder.counter('requests'),
        responseCounter: self._recorder.counter('responses'),
        errorCounter: self._recorder.counter('errors'),
        setupError: self._recorder.counter('setup_error'),
        parseError: self._recorder.counter('parse_error'),
        transportError: self._recorder.counter('transport_error'),
        serializeError: self._recorder.counter('serialize_error'),
        framingError: self._recorder.counter('framing_error'),
        timeoutCounter: self._recorder.counter('timeouts'),

        setupLatency: self._recorder.timer('setup_latency_ms'),
        requestLatency: self._recorder.timer('request_latency_ms'),
    }

    this._log = null;

    if (opts.log) {
        this._log = opts.log.child({
            component: 'rs-connection'
        });
    } else {
        this._log = LOG;
    }

    self._log.debug({opts: opts}, 'rs.connection: new');

    this._type = opts.type;
    this._isSetup = false;
    this._version = (self._type === 'client') ? CONSTANTS.VERSION : null;
    this._keepalive = opts.keepalive || 1 * 1000;
    this._leaseNumberOfRequests = 0; // how many messages I'm allowed to send
    this._leaseExpirationDate = Date.now(); // date when the lease expire
    this._requestTimeoutMs = opts.requestTimeoutMs || 30 * 1000;
    // TODO: we don't use this today
    this._maxLifetime = opts.maxLifetime || 10 * 1000;
    // maps a streamId from the server to a client interaction.
    this._streams = {
        // as we add 2 to the latest streamId, this create id starting at 2
        // for the client and 1 for the server.
        latest: self._type === 'client' ? 0 : -1,
        streams: {}
    };
    this._sStream = new SerializeStream({
        log: self._log,
        dataEncoding: self._dataEncoding,
        metadataEncoding: self._metadataEncoding
    });
    this._pStream = new ParseStream({
        log: self._log,
        dataEncoding: self._dataEncoding,
        metadataEncoding: self._metadataEncoding
    });
    this._transportStream = opts.transport.stream;

    var transportStreamErr;
    self._transportStream.once('close', function onClose() {
        self._metrics.close.incr();
        self.emit('close');
        self._log.info('rs-connection: transport closed, emitting error to ' +
                       'all active streams');
        self._log.debug({streams: self._streams},
                        'rs-connection: transport closed');
        // if the transport is closed, this connection is kaput, we must inform
        // all of the outstanding RS streams that there is an error
        _(self._streams.streams).forEach(function (stream) {
            var streamId = stream.getId();
            // skip the setup stream -- since it's persistent and has no error
            // listener
            if (streamId ===  0) {
                return;
            }
            self._log.info({streamId: streamId},
                            'rs-connection: sending error to stream');
            stream.setError(transportStreamErr ||
                            new Error('transport connection closed'));
        });
        // cancel all running timers
        self._timers.forEach(function (timer) {
            clearInterval(timer);
        });
    });

    self._transportStream.on('error', function onTransportError(err) {
        self._metrics.transportError.incr();
        self._log.error({err: err}, 'rs-connection: got transport error');
        self.emit('error', err);
        transportStreamErr = err;
    });

    self._pStream.on('error', function onParseError(err) {
        self._metrics.parseError.incr();
        self._log.error({err: err}, 'rs-connection: got parse error');
        self.emit('error', err);
    });

    self._sStream.on('error', function onSerializeError(err) {
        self._metrics.serializeError.incr();
        self._log.error({err: err}, 'rs-connection: got serialize error');
        self.emit('error', err);
    });

    // Mux between different frame types
    self._pStream.on('data', function onRead(frame) {
        self._log.debug({frame: frame}, 'rsClient.gotFrame');

        switch (frame.header.type) {
            case TYPES.ERROR:
                self._metrics.errorCounter.incr();
                self._handleError(frame);
                break;
            case TYPES.RESPONSE:
                self._metrics.responseCounter.incr();
                self._handleResponse(frame);
                break;
            case TYPES.REQUEST_RESPONSE:
                self._handleRequest(frame);
                break;
            case TYPES.SETUP:
                self._handleSetup(frame);
                break;
            case TYPES.LEASE:
                self._handleLease(frame);
                break;
            case TYPES.KEEPALIVE:
                self._handleKeepalive(frame);
                break;
            case TYPES.CANCEL:
                self._handleCancel(frame);
                break;
            case TYPES.REQUEST_FNF:
            case TYPES.REQUEST_STREAM:
            case TYPES.REQUEST_SUB:
            case TYPES.REQUEST_CHANNEL:
            case TYPES.REQUEST_N:
            case TYPES.METADATA_PUSH:
            case TYPES.NEXT:
            case TYPES.COMPLETE:
            case TYPES.NEXT_COMPLETE:
            case TYPES.EXT:
            default:
                self.emit('error',
                          new Error(frame.header.type +
                                    ' frame not supported'));
                break;
        }
    });

    // setup transport
    self._sStream.pipe(self._transportStream);

    if (opts.transport.framed) {
        this._framingStream = new FramingStream({log: self._log});
        self._framingStream.on('error', function onFramingError(err) {
            self._log.error({err: err}, 'rs-connection: got framing error');
            self._metrics.framingError.incr();
            self.emit('error', err);
        });
        self._transportStream.pipe(self._framingStream)
            .pipe(self._pStream);
    } else {
        self._transportStream.pipe(self._pStream);
    }

    // array of timers used by periodic tasks
    this._timers = [];

    // send setup frame if client
    if (self._type === 'server') {
        setImmediate(function () {
            self.emit('ready');
        });
    } else {
        var setupLatencyTimerId = self._metrics.setupLatency.start();
        self.setup({
            lease: opts.lease,
            metadata: opts.setupMetadata,
            data: opts.setupData
        }, function (err) {
            self._log.debug({err: err}, 'Connection.new: established');
            // need to return Connection first before we emit the ready event
            setImmediate(function ready() {
                if (err) {
                    self._metrics.setupError.incr();
                    self.emit('error', err);
                } else {
                    if (opts.lease) {
                        self.once('lease', function onFirstLease(frame) {
                            self._log.debug({frame: frame},
                                'Connection.new: lease negotiated');
                            self._metrics.setupLatency.stop(
                                setupLatencyTimerId);
                            self.emit('ready');
                        });
                    } else {
                        self._metrics.setupLatency.stop(setupLatencyTimerId);
                        self.emit('ready');
                    }
                }
            });
        });

        var ticker = setInterval(function keepaliveTicker () {
            self._sendKeepalive(true);
        }, self._keepalive);
        self._timers.push(ticker);
    }
}
util.inherits(Connection, EventEmitter);

module.exports = Connection;


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
Connection.prototype.request = function request(req) {
    var self = this;
    self._metrics.requestCounter.incr();
    var stream = self._getNewStream();
    stream.startTimeout(self._requestTimeoutMs);
    var streamId = stream.getId();
    var frame = {
        type: TYPES.REQUEST_RESPONSE,
        flags: req.follows ? FLAGS.FOLLOWS : FLAGS.NONE,
        data: req.data,
        metadata: req.metadata,
        streamId: streamId
    };

    self._leaseNumberOfRequests = Math.max(0, self._leaseNumberOfRequests - 1);
    self.send(frame);

    stream.on('timeout', function onTimeout () {
        self._metrics.timeoutCounter.incr();
        self._deleteStream(streamId);
    });

    return stream;
};

/**
 * Send a setup frame. Used for unit tests. This is not meant for consumers of
 * this API, since the connection automatically sends as setup frame on
 * creation.
 * @param {Object} su The setup object.
 * @param {String} [su.data=null] The data string.
 * @param {String} [su.metadata=null] The metadata string.
 * @param {Function} cb The callback f(err)
 *
 * @returns {RSStream} The setup stream object.
 */
Connection.prototype.setup = function setup(su, cb) {
    var self = this;

    if (self.type === 'server') {
        cb(new Error('can not send setup frame as server'));
        return null;
    }
    self._setupStream = self._getStream(0);
    var flags = CONSTANTS.FLAGS.NONE;

    if (su.lease) {
        flags |= CONSTANTS.FLAGS.LEASE;
    }

    if (su.strict) {
        flags |= CONSTANTS.FLAGS.STRICT;
    }
    self.send({
        type: CONSTANTS.TYPES.SETUP,
        flags: flags,
        lease: su.lease,
        keepalive: self._keepalive,
        maxLifetime: self._maxLifetime,
        version: CONSTANTS.VERSION,
        metadataEncoding: self._metadataEncoding,
        dataEncoding: self._dataEncoding,
        metadata: su.metadata,
        data: su.data
    }, cb);

    return self._setupStream;
};

/**
 * Send any frame to the remote connection.
 * @param {Object} frame - a RS frame.
 * @param {Function} [cb] - Callback when frame has been written.
 *
 * @returns {null}
 */
Connection.prototype.send = function send(frame, cb) {
    var self = this;
    self._log.debug({frame: frame}, 'Connection.send: entering');

    self._sStream.write(frame, cb);
};

/**
 * Send a lease frame
 * @param {Number} numberOfRequest the number of request the client is allowed
 * to send.
 * @param {Number} ttl the duration of the lease validity in millisecond.
 *
 * @returns {null}
 */
Connection.prototype.sendLease = function send(numberOfRequest, ttl) {
    var self = this;
    self._log.debug({numberOfRequest: numberOfRequest, ttl: ttl},
        'Connection.sendLease: entering');

    var frame = {
        type: TYPES.LEASE,
        budget: numberOfRequest,
        ttl: ttl
    };

    self.send(frame);
};

/**
 * Return the current availability.
 *
 * @returns {availability} a number between 0.0 and 1.0 (higher is better)
 */
Connection.prototype.availability = function availability() {
    var self = this;

    var inLeaseWindow = self._leaseNumberOfRequests > 0
        && self._leaseExpirationDate >= Date.now();
    var availabilityValue = inLeaseWindow ? 1.0 : 0.0;

    self._log.debug({availability: availability},
        'Connection.availability: returning ');
    return availabilityValue;
};


/**
 * Close the ReactiveSocket, which close the underlying Transport (e.g. TCP).
 *
 * @returns {null}
 */
Connection.prototype.close = function close() {
    var self = this;
    self._log.debug('Connection.close: executing ');
    self._transportStream.end();
};


/// Frame handlers


Connection.prototype._handleSetup = function _handleSetup(frame) {
    var self = this;
    self._log.debug({frame: frame}, 'Connection._handleSetup: entering');

    var stream = self._getStream(0);

    if (self._isSetup || self._type === 'client') {
        self._log.warn({frame: frame},
                       'Connection._setup: got extra setup frame');
        stream.setError({
            errorCode: ERROR_CODES.REJECTED_SETUP,
            data: 'extra setup frame'
        });
        return;
    }

    if (frame.setup.lease) {
        // This dummy strategy, grant leases to every clients at a maximum rate
        // of 2^30 requests per 5 seconds
        var budget = 1 << 30;
        self.sendLease(budget, 1000);
        var ticker = setInterval(function leaseTicker() {
            self.sendLease(budget, 1000);
        }, 5000);
        self._timers.push(ticker);
    }

    // TODO: validate setup frame -- return setup_error on bad frame.
    self._version = frame.version;
    self._keepalive = frame.keepalive;
    self._maxLifetime = frame.maxLifetime;
    self._metadataEncoding = frame.metadataEncoding;
    self._dataEncoding = frame.dataEncoding;
    // set the encoding of the s and p streams based on setup.
    self._pStream.setEncoding(self._metadataEncoding, self._dataEncoding);
    self._sStream.setEncoding(self._metadataEncoding, self._dataEncoding);

    self._isSetup = true;

    stream.setup = frame;
    self.emit('setup', stream);
    self._log.debug({setup: self._isSetup}, 'Connection._handleSetup: exiting');
};

Connection.prototype._handleLease = function _handleLease(frame) {
    var self = this;
    self._log.debug({frame: frame}, 'Connection._handleLease: entering');

    self._leaseNumberOfRequests = frame.budget;
    self._leaseExpirationDate = Date.now() + frame.ttl;

    self.emit('lease', frame);
    self._log.debug({setup: self._isSetup}, 'Connection._handleLease: exiting');
};

Connection.prototype._handleKeepalive = function _handleKeepalive(frame) {
    var self = this;
    self._log.debug({frame: frame}, 'Connection._handleKeepalive: entering');

    self.emit('keepalive', frame);

    if (frame.response) {
        self._sendKeepalive(false);
    }
};

Connection.prototype._handleRequest = function _handleRequest(frame) {
    var self = this;

    // we ignore any requests if we haven't gotten a setup stream yet.
    if (!self._isSetup && self._type === 'server') {
        self._log.warn({frame: frame},
                       'Connection._handleRequest: got frame before setup');
        return;
    }

    var streamId = frame.header.streamId;
    var stream = self._getStream(streamId);
    stream.on('response', function () {
        self._deleteStream(streamId);
    });
    stream.on('error', function () {
        self._deleteStream(streamId);
    });
    stream.setRequest(frame);
};

Connection.prototype._handleResponse = function _handleResponse(frame) {
    var self = this;
    var stream = self._getStream(frame.header.streamId);

    if (!stream) {
        // Crash here? Not sure since it could be the remote misbehaving
        self._log.error({frame: frame},
            'Connection._handleResponse: got frame with unknown streamId');
        self.emit('error', new Error('Connection Error, unexpected streamid' +
                                     ' from remote'));
        return;
    }

    stream.setResponse(frame);
    self._deleteStream(frame.header.streamId);
};

Connection.prototype._handleError = function _handleError(frame) {
    var self = this;
    self._log.debug({frame: frame}, 'Connection._error: entering');

    var stream = self._getStream(frame.header.streamId);

    stream.setError(frame);
    self._deleteStream(frame.header.streamId);
};

Connection.prototype._handleCancel = function _handleCancel(frame) {
    var self = this;
    self._log.debug({frame: frame}, 'Connection._cancel: entering');

    var stream = self._getStream(frame.header.streamId);

    stream.setCancel(frame);
    self._deleteStream(frame.header.streamId);
};


/// Privates

// Send a Keepalive frame.
Connection.prototype._sendKeepalive = function _sendKeepalive(requireResponse) {
    var self = this;
    self._log.debug({requireResponse: requireResponse},
        'Connection.keepalive: entering');

    var frame = {
        type: TYPES.KEEPALIVE,
        response: requireResponse,
        data: '' // data is optional, empty for saving bandwidth
    };

    self.send(frame);
};

// Initiating streams will invoke this to get a new streamid.
Connection.prototype._getNewStream = function _getNewStream() {
    var self = this;
    self._log.debug({latest_id: self._streams.latest},
                    'Connection._getNewStream: entering');
    var id = self._streams.latest + 2;

    if (id > CONSTANTS.MAX_STREAM_ID) {
        self._emit('error', new Error('Stream ID Exhaustion'));
    }

    var stream = new RSStream({
        connection: self,
        log: self._log,
        id: id,
        timer: self._metrics.requestLatency
    });

    self._streams.latest += 2;

    self._streams.streams[id] = stream;

    self._log.debug({latest_id: self._streams.latest, id: id},
                    'Connection._getNewStream: exiting');
    return stream;
};

// Responding streams will invoke this to persist a stream id
Connection.prototype._getStream = function _getStream(id) {
    var self = this;

    if (!self._streams.streams[id]) {
        self._streams.streams[id] = new RSStream({
            connection: self,
            log: self._log,
            id: id,
            timer: self._metrics.requestLatency
        });
    }

    return self._streams.streams[id];
};

// Delete a stream from the table.
Connection.prototype._deleteStream = function _deleteStream(id) {
    var self = this;

    delete self._streams.streams[id];
};
