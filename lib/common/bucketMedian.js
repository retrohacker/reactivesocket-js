'use strict';

function BucketMedian(max) {
    var self = this;
    this._max = max || 64;
    this._buffer = new Array(2 * self._max);
    this._from = self._max;
    this._to = self._from;
}

module.exports = BucketMedian;

BucketMedian.prototype.insert = function insert(x) {
    var self = this;
    var n = self._to - self._from;

    if (n === 0) {
        self._buffer[self._from] = x;
        self._to += 1;
        return;
    }

    var midpoint = (self._from + self._to) >> 1;
    var center = self._buffer[midpoint];
    var i = midpoint;

    if (x > center) {
        // insert to the right
        if (self._to === 2 * self._max) {
            self._compact();
        }

        // make room for the new value
        i = self._shiftRight(i + 1, x);
        self._buffer[i] = x;
        self._to += 1;

        if (n === self._max) {
            self._from += 1;
        }
    } else {
        // insert to the left
        if (self._from === 0) {
            self._compact();
        }

        // make room for the new value
        i = self._shiftLeft(i - 1, x);
        self._buffer[i] = x;
        self._from -= 1;

        if (n === self._max) {
            self._to -= 1;
        }
    }
}

BucketMedian.prototype.estimate = function estimate() {
    var self = this;

    if (self._to === self._from) {
        return 0;
    } else {
        var midpoint = (self._from + self._to) >> 1;
        return self._buffer[midpoint];
    }
}

/// Privates

BucketMedian.prototype._shiftRight = function _shiftRight(start, x) {
    var self = this;

    // Binary search to find where to insert
    var from = start;
    var to = self._to;
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
}

BucketMedian.prototype._shiftLeft = function _shiftLeft(end, x) {
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
}

BucketMedian.prototype._compact = function _compact() {
    var self = this;
    var i, j;

    if (self._from === 0) {
        j = self._max + (self._max / 2 >> 0) - 1;
        for (i = self._max - 1; i >= 0; i-- , j--) {
            self._buffer[j] = self._buffer[i];
        }
    } else {
        j = self._max >> 1;
        for (i = self._from; i < self._to; i++ , j++) {
            self._buffer[j] = self._buffer[i];
        }
    }

    self._from = self._max >> 1;
    self._to = self._from + self._max;
}
