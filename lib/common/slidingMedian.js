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
    var self = this;
    this._size = size || 64;

    this._buffer = new Array(2 * self._size);
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
        self._buffer[self._from] = x;
        self._to += 1;
        return;
    }

    var midpoint = (self._from + self._to) >> 1;
    var i = midpoint;

    if (x > self._buffer[midpoint]) { // insert to the right

        // compact if we're out of space to the right
        if (self._to === 2 * self._size) {
            self._compact();
        }

        // make room for the new value
        i = self._shiftRight(i + 1, x);
        self._buffer[i] = x;
        self._to += 1;

        if (n === self._size) {
            self._from += 1;
        }
    } else { // insert to the left

        // compact if we're out of space to the left
        if (self._from === 0) {
            self._compact();
        }

        // make room for the new value
        i = self._shiftLeft(i - 1, x);
        self._buffer[i] = x;
        self._from -= 1;

        if (n === self._size) {
            self._to -= 1;
        }
    }
}

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
        return self._buffer[midpoint];
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

        if (self._buffer[mid] < x) {
            from = mid + 1;
        } else {
            to = mid - 1;
        }
    }

    // move all the elements (after the insertion point) to the right by one.
    for (var k = self._to; k >= from; k--) {
        self._buffer[k] = self._buffer[k - 1];
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

        if (self._buffer[mid] < x) {
            from = mid + 1;
        } else {
            to = mid - 1;
        }
    }

    // move all the elements (after the insertion point) to the left by one
    for (var k = self._from - 1; k < to; k++) {
        self._buffer[k] = self._buffer[k + 1];
    }

    return to;
};

/**
 * Move all the elements in the middle of the buffer.
 * It gives room at the left and right of the buffer for later addition.
 *
 * @returns {null}
 */
SlidingMedian.prototype._compact = function _compact() {
    var self = this;
    var i, j;

    if (self._from === 0) {
        j = self._size + (self._size / 2 >> 0) - 1;

        for (i = self._size - 1; i >= 0; i-- , j--) {
            self._buffer[j] = self._buffer[i];
        }
    } else {
        j = self._size >> 1;

        for (i = self._from; i < self._to; i++ , j++) {
            self._buffer[j] = self._buffer[i];
        }
    }

    self._from = self._size >> 1;
    self._to = self._from + self._size;
};

SlidingMedian.prototype.toString = function toString() {
    var self = this;

    var msg = 'from: ' + self._from + ' to: ' + self._to +' [';
    var i = 0;
    _.forEach(self._buffer, function (x) {
        msg += '(' + i + ':' + x + '),\n';
        i++;
    })
    msg = msg.substring(0, msg.length - 1) + ']';
    return msg;
}