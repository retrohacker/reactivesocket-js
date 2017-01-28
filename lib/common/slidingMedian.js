'use strict';

var _ = require('lodash');

/**
 * SlidingMedian
 *
 * Compute a streaming median
 *
 * @param {Number} size number of elements to keep in the buffer
 * @returns {SlidingMedian}
 */
function SlidingMedian(size) {
    if (size & (size - 1) !== 0) {
        throw new Error('Illegal argument, `size` should be a power of 2!');
    }
    var self = this;
    this._size = size || 32;
    this._moduloMask = size - 1;
    this._ringBuffer = new Array(self._size);
    this._from = self._size;
    this._to = self._from;
}

module.exports = SlidingMedian;

/**
 * Insert a value in the median estimator.
 *
 * @param {Number} x the value to insert.
 * @returns {null}
 */
SlidingMedian.prototype.insert = function insert(x) {
    var self = this;
    var n = self._to - self._from;

    if (n === 0) {
        self._ringBuffer[self._from & self._moduloMask] = x;
        self._to += 1;
        return;
    }

    var midpoint = (self._from + self._to) >> 1;
    var i = midpoint;

    if (x > self._ringBuffer[midpoint & self._moduloMask]) {
        // insert to the right
        // make room for the new value
        i = self._shiftRight(i + 1, x);
        self._ringBuffer[i & self._moduloMask] = x;
        self._to += 1;

        if (n === self._size) {
            self._from += 1;
        }
    } else { // insert to the left
        // make room for the new value
        i = self._shiftLeft(i - 1, x);
        self._ringBuffer[i & self._moduloMask] = x;
        self._from -= 1;

        if (n === self._size) {
            self._to -= 1;
        }
    }
};

/**
 * Estimate the current median value.
 *
 * @returns {Number} returns the current estimate or 0 if no values have been
 * inserted.
 */
SlidingMedian.prototype.estimate = function estimate() {
    var self = this;

    if (self._to === self._from) {
        return 0;
    } else {
        var midpoint = (self._from + self._to) >> 1;
        return self._ringBuffer[midpoint & self._moduloMask];
    }
};


/// Privates

/**
 * Find where to insert the `x` value, then shift all elements at the right of
 * that value by one (to the right).
 *
 * @param {Number} start index where to start to look for inserting the value
 * @param {Number} x the value we want to insert
 *
 * @returns {null}
 */
SlidingMedian.prototype._shiftRight = function _shiftRight(start, x) {
    var self = this;

    // Binary search to find where to insert
    var from = start;
    var to = self._to - 1;

    while (from <= to) {
        var mid = (from + to) >> 1;

        if (self._ringBuffer[mid & self._moduloMask] < x) {
            from = mid + 1;
        } else {
            to = mid - 1;
        }
    }

    // move all the elements (after the insertion point) to the right by one.
    for (var k = self._to; k >= from; k--) {
        self._ringBuffer[k & self._moduloMask] =
            self._ringBuffer[(k - 1) & self._moduloMask];
    }

    return from;
};

/**
 * Find where to insert the `x` value, then shift all elements at the left of
 * that value by one (to the left).
 *
 * @param {Number} end index where to start to look for inserting the value
 * @param {Number} x the value we want to insert
 *
 * @returns {null}
 */
SlidingMedian.prototype._shiftLeft = function _shiftLeft(end, x) {
    var self = this;

    // Binary search to find where to insert
    var from = self._from;
    var to = end;

    while (from <= to) {
        var mid = (from + to) >> 1;

        if (self._ringBuffer[mid & self._moduloMask] < x) {
            from = mid + 1;
        } else {
            to = mid - 1;
        }
    }

    // move all the elements (after the insertion point) to the left by one
    for (var k = self._from - 1; k < to; k++) {
        self._ringBuffer[k & self._moduloMask] =
            self._ringBuffer[(k + 1) & self._moduloMask];
    }

    return to;
};

SlidingMedian.prototype.toString = function toString() {
    var self = this;

    var msg = 'from: ' + self._from + ' to: ' + self._to + ' [';
    var i = 0;
    _.forEach(self._ringBuffer, function (x) {
        msg += '(' + (i & self._moduloMask) + ':' + x + '),\n';
        i++;
    });
    msg = msg.substring(0, msg.length - 1) + ']';
    return msg;
};
