'use strict';

var stream = require('stream');
var util = require('util');

var assert = require('assert-plus');

var parseFrame = require('../protocol/frame/parseFrame');

var LOG = require('../logger');


/**
 * @constructor
 * @param {Object} opts -
 * @param {Object} [opts.log=log] -
 * Stream that transforms a framed stream of bytes into RS frames.
 */
function ParseStream(opts) {
    assert.optionalObject(opts, 'opts');

    if (!opts) {
        opts = {};
    }
    assert.optionalObject(opts.log, 'opts,log');
    assert.optionalString(opts.metadataEncoding, 'opts.metadataEncoding');
    assert.optionalString(opts.dataEncoding, 'opts.dataEncoding');

    this._dataEncoding = opts.dataEncoding;
    this._metadataEncoding = opts.metadataEncoding;
    this._log = null;

    if (opts.log) {
        this._log = opts.log.child({
            component: 'ParseStream'
        });
    } else {
        this._log = LOG;
    }


    stream.Transform.call(this, {readableObjectMode: true});

}
util.inherits(ParseStream, stream.Transform);

module.exports = ParseStream;

ParseStream.prototype._transform = function _transform(chunk, enc, cb) {
    var self = this;
    var frame = parseFrame(chunk, self._metadataEncoding, self._dataEncoding);
    self.push(frame);
    return cb();
};

/**
 * @param {String} metadataEncoding The encoding of the metadata
 * @param {String} dataEncoding The encoding of the data
 * Set the encoding of this stream. Before we receive the setup frame, which
 * contains encoding information for this stream, we won't know the encoding.
 *
 * @returns {null}
 */
ParseStream.prototype.setEncoding = function setEncoding(metadataEncoding,
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
