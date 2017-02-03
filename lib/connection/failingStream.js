'use strict';

var assert = require('assert-plus');
var stream = require('stream');
var util = require('util');

/**
 * @constructor
 * @param {Object} error The error to return
 * @returns {Object}
 */
function FailingStream(error) {
    assert.object(error, 'error');
    this._error = error;

    stream.Transform.call(this);
}
util.inherits(FailingStream, stream.Transform);

module.exports = FailingStream;

FailingStream.prototype.on = function (what, f) {
    var self = this;

    if (what === 'error' || what === 'terminate') {
        setImmediate(function () {
            f(self._error);
        });
    }
    return self;
};
