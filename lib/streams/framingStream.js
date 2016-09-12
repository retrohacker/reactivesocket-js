'use strict';

var stream = require('stream');
var util = require('util');

var assert = require('assert-plus');

var LOG = require('../logger');

/**
 * Frames a RS frame. For transport protocols such as TCP, which don't support
 * framing out of the box, you can insert this stream in front of the
 * ParseStream to ensure that buffers off the wire are properly framed by the
 * length of the frame before being sent to the PraseStream.
 *
 * @constructor
 * @param {Object} opts The options object
 * @param {Object} [log=bunyan]  The logger
 * @returns {Object}
 */
function FramingStream(opts) {
    assert.optionalObject(opts, 'opts');

    if (!opts) {
        opts = {};
    }
    assert.optionalObject(opts.log, 'opts.log');

    this._log = null;

    /**
     * Buffer used for buffering partial frame
     */
    this._buffer = null;

    /**
     * Length of the frame currently buffered
     */
    this._frameLength = 0;

    /**
     * Write position in the current buffer
     */
    this._pos = 0;

    if (opts.log) {
        this._log = opts.log.child({
            component: 'FramingStream'
        });
    } else {
        this._log = LOG;
    }

    stream.Transform.call(this);
}
util.inherits(FramingStream, stream.Transform);

module.exports = FramingStream;

FramingStream.prototype._transform = function _transform(chunk, enc, cb) {
    var self = this;

    // pos represents the current reading position in the chunk buffer
    var pos = 0;

    /*
     * all reactive socket frames begin with a header, which starts with a 31
     * bit int with the length of the frame. we need to parse the int, save the
     * buffer until we reach the length of the frame, then emit it.
     *
     * The chunk may encapsulate 1* complete frames, and at maximum 2
     * incomplete frames.
     * e.g. [incomplete frame][complete frames][incomplete frame]
     *
     * We check to see if we've finished parsing through the entire chunk.
     * If the current frame is complete, we reset state and continue parsing the
     * next frame. Otherwise, we attempt to parse the current frame.
     */
    while (pos < chunk.length) {
        var msgLen;
        var chunkLen = chunk.length - pos;

        if (!self._buffer) {
            if (chunkLen > 4) {
                // we have enough bytes to know the size of the frame
                msgLen = chunk.readUInt32BE(pos);

                if (chunkLen >= msgLen) {
                    // we have one full frame
                    // slice and push to avoid unnecessary copies
                    var frame = chunk.slice(pos, pos + msgLen);
                    pos += msgLen;
                    self.push(frame);
                } else {
                    // partial frame, start buffering
                    self._buffer = new Buffer(msgLen);
                    self._frameLength = msgLen;
                    chunk.copy(self._buffer, 0, pos);
                    self._pos = chunkLen;
                    pos += chunkLen;
                }
            } else {
                self._buffer = new Buffer(4);
                chunk.copy(self._buffer, 0, pos);
                self._pos = chunkLen;
                pos += chunkLen;
            }
        } else if (self._frameLength === 0) {
            // already buffer some bytes but less than 4 bytes,
            // we still need to buffer more bytes to read the frame size
            assert(pos === 0);
            var k = Math.min(4 - self._pos, chunkLen);
            chunk.copy(self._buffer, self._pos, 0, k);
            pos += k;
            self._pos += k;

            if (self._pos === 4) {
                msgLen = self._buffer.readUInt32BE(self._pos - 4);
                var buffer = new Buffer(msgLen);
                self._buffer.copy(buffer, 0, 0, 4);
                self._buffer = buffer;
                self._frameLength = msgLen;
            }
        } else {
            // already buffer some of the message, continue buffering
            var n = Math.min(self._frameLength - self._pos, chunkLen);
            chunk.copy(self._buffer, self._pos, pos, pos + n);
            self._pos += n;
            pos += n;

            if (self._pos === self._frameLength) {
                self.push(self._buffer);
                self._buffer = null;
                self._frameLength = 0;
                self._pos = 0;
            }
        }
    }
    cb();
};

