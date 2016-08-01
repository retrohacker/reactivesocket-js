'use strict';

var stream = require('stream');
var util = require('util');

var assert = require('assert-plus');

var frame = require('../protocol/frame');

var CONSTANTS = require('../protocol/constants');

var LOG = require('../logger');


/**
 * @constructor
 * @param {Object} opts The options object
 * @param {Object} [log=bunyan]  The logger
 * @returns {Object}
 */
function SerializeStream(opts) {
    assert.optionalObject(opts, 'opts');

    if (!opts) {
        opts = {};
    }
    assert.optionalObject(opts.log, 'opts.log');
    assert.optionalString(opts.metadataEncoding, 'opts.metadataEncoding');
    assert.optionalString(opts.dataEncoding, 'opts.dataEncoding');

    this._metadataEncoding = opts.metadataEncoding;
    this._dataEncoding = opts.dataEncoding;
    this._log = null;

    if (opts.log) {
        this._log = opts.log.child({
            component: 'SerializeStream'
        });
    } else {
        this._log = LOG;
    }


    stream.Transform.call(this, {writableObjectMode: true});
}
util.inherits(SerializeStream, stream.Transform);

module.exports = SerializeStream;

SerializeStream.prototype._transform = function _transform(f, enc, cb) {
    var self = this;
    self._log.debug({
        frame: f
    }, 'SerializeStream._transform: entering');

    assert.object(f, 'frame');
    assert.number(f.type, 'frame.type');

    f.metadataEncoding = self._metadataEncoding;
    f.dataEncoding = self._dataEncoding;

    var buf;

    switch (f.type) {
        case CONSTANTS.TYPES.REQUEST_RESPONSE:
            buf = frame.getReqResFrame(f);
            break;
        case CONSTANTS.TYPES.SETUP:
            buf = frame.getSetupFrame(f);
            break;
        case CONSTANTS.TYPES.LEASE:
            buf = frame.getLeaseFrame(f);
            break;
        case CONSTANTS.TYPES.ERROR:
            buf = frame.getErrorFrame(f);
            break;
        case CONSTANTS.TYPES.KEEPALIVE:
            buf = frame.getKeepaliveFrame(f);
            break;
        case CONSTANTS.TYPES.RESPONSE:
            buf = frame.getResponseFrame(f);
            break;
        default:
            return cb(new Error('type ' + f.type + ' not supported'));
    }

    self.push(buf);
    cb();
};

/**
 * @param {String} metadataEncoding The encoding of the metadata
 * @param {String} dataEncoding The encoding of the data
 * Set the encoding of this stream. Before we receive the setup frame, which
 * contains encoding information for this stream, we won't know the encoding.
 *
 * @returns {null}
 */
SerializeStream.prototype.setEncoding = function setEncoding(metadataEncoding,
                                                             dataEncoding) {
    var self = this;
    assert.string(dataEncoding, 'dataEncoding');
    assert.string(metadataEncoding, 'metadataEncoding');

    if (!self._dataEncoding) {
        this._dataEncoding = dataEncoding;
    }

    if (!self._metadataEncoding) {
        this._metadataEncoding = metadataEncoding;
    }
};
