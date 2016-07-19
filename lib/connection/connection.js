'use strict';

var util = require('util');

var EventEmitter = require('events');

var _ = require('lodash');
var assert = require('assert-plus');
var bunyan = require('bunyan');

var FramingStream = require('../streams/framingStream');
var ParseStream = require('../streams/parseStream');
var RSStream = require('./stream');
var SerializeStream = require('../streams/serializeStream');

var CONSTANTS = require('../protocol/constants');
var ERROR_CODES = CONSTANTS.ERROR_CODES;
var FLAGS = CONSTANTS.FLAGS;
var LOG = require('../logger');
var TYPES = CONSTANTS.TYPES;

/**
 * Connection
 *
 * @param {Object} opts Options object
 * @param {Ojbect} [opts.log=bunyan] Bunyan logger
 * @param {Object} [opts.transport.stream] Underlying transport stream
 * @param {Object} [opts.transport.framed=false] Whether the transport needs to
 * be framed. Defaults to false
 * @param {Boolean} opts.type Type of connection, one of 'client' or 'server'
 * @param {Number} [opts.keepalive=1000] Keep alive interval
 * @param {Number} [opts.maxLifetime=10000] maxLifetime interval.
 * @param {String} [metadataEncoding=utf8] metadata encoding. Only set for
 * client conns.
 * @param {String} [dataEncoding=utf8] data encoding. Only set for client conns.
 * @param {Boolean} [opts.lease] Whether lease is supported
 * @param {Boolean} [opts.strict] Whether connection is in strict mode
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

    var self = this;

    this._log = null;

    if (opts.log) {
        this._log = opts.log.child({
            component: 'rs-connection',
            level: process.env.LOG_LEVEL || bunyan.WARN
        });
    } else {
        this._log = LOG;
    }

    self._log.debug({opts: opts}, 'rs.connection: new');

    this._type = opts.type;
    this._isSetup = false;
    this._version = (self._type === 'client') ? CONSTANTS.VERSION : null;
    // TODO: setInterval when we have keepalive frames done
    this._keepalive = opts.keepalive || 1 * 1000;
    // TODO: we don't use this today
    this._maxLifetime = opts.maxLifetime || 10 * 1000;
    // maps a streamId from the server to a client interaction.
    this._streams = {
        latest: 0,
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
    self._transportStream.once('close', function close() {
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
    });

    self._transportStream.on('error', function error(err) {
        self._log.error({err: err}, 'rs-connection: got transport error');
        self.emit('error', err);
        transportStreamErr = err;
    });

    self._pStream.on('error', function error(err) {
        self._log.error({err: err}, 'rs-connection: got parse error');
        self.emit('error', err);
    });
    self._sStream.on('error', function error(err) {
        self._log.error({err: err}, 'rs-connection: got serialize error');
        self.emit('error', err);
    });

    // Mux between different frame types
    self._pStream.on('data', function read(frame) {
        self._log.debug({frame: frame}, 'rsClient.gotFrame');

        switch (frame.header.type) {
            case TYPES.ERROR:
                self._handleError(frame);
                break;
            case TYPES.RESPONSE:
                self._handleResponse(frame);
                break;
            case TYPES.REQUEST_RESPONSE:
                self._handleRequest(frame);
                break;
            case TYPES.SETUP:
                self._handleSetup(frame);
                break;
            case TYPES.LEASE:
            case TYPES.KEEPALIVE:
            case TYPES.REQUEST_FNF:
            case TYPES.REQUEST_STREAM:
            case TYPES.REQUEST_SUB:
            case TYPES.REQUEST_CHANNEL:
            case TYPES.REQUEST_N:
            case TYPES.CANCEL:
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
        self._framingStream.on('error', function (err) {
            self._log.error({err: err}, 'rs-connection: got framing error');
            self.emit('error', err);
        });
        self._transportStream.pipe(self._framingStream)
            .pipe(self._pStream);
    } else {
        self._transportStream.pipe(self._pStream);
    }

    // send setup frame if client
    if (self._type === 'server') {
        setImmediate(function () {
            self.emit('ready');
        });
    } else {
        self.setup({
            metadata: opts.setupMetadata,
            data: opts.setupData
        }, function (err) {
            self._log.debug({err: err}, 'Connection.new: finished');
            // need to return Connection first before we emit the ready event
            setImmediate(function ready() {
                if (err) {
                    self.emit('error', err);
                } else {
                    self.emit('ready');
                }
            });
        });
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
    var stream = self._getNewStream();
    var frame = {
        type: TYPES.REQUEST_RESPONSE,
        flags: req.follows ? FLAGS.FOLLOWS : FLAGS.NONE,
        data: req.data,
        metadata: req.metadata,
        streamId: stream.getId()
    };

    self.send(frame);

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

    // TODO: add leasing and strict mode interpretation here.
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

Connection.prototype._handleRequest = function _handleRequest(frame) {
    var self = this;

    // we ignore any requests if we haven't gotten a setup stream yet.
    if (!self._isSetup && self._type === 'server') {
        self._log.warn({frame: frame},
                       'Connection._handleRequest: got frame before setup');
        return;
    }

    var stream = self._getStream(frame.header.streamId);
    stream.setRequest(frame);
    self._deleteStream(frame.header.streamId);
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


/// Privates


// Initiating streams will invoke this to get a new streamid.
Connection.prototype._getNewStream = function _getNewStream() {
    var self = this;
    self._log.debug({latest_id: self._streams.latest},
                    'Connection._getNewStream: entering');
    var id;

    if (self._streams.latest === 0) {
        if (self._type === 'client') {
            id = 2;
        } else {
            id = 1;
        }
    } else {
        id = self._streams.latest + 2;
    }

    if (id > CONSTANTS.MAX_STREAM_ID) {
        self._emit('error', new Error('Stream ID Exhaustion'));
    }

    var stream = new RSStream({
        connection: self,
        log: self._log,
        id: id
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
            id: id
        });
    }

    return self._streams.streams[id];
};

// Delete a stream from the table.
Connection.prototype._deleteStream = function _deleteStream(id) {
    var self = this;

    if (!self._streams.streams[id]) {
        self.emit('error', new Error('Deleting non-existent stream id ' + id));
    }

    delete self._streams.streams[id];
};
