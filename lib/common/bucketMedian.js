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

    //console.log(self.toString());
    //console.log('insert:' + x + ', n:' + n + ', from:' + self._from + ', to:' + self._to);

    if (n === 0) {
        self._buffer[self._from] = x;
        self._to += 1;
        return;
    }

    var midpoint = Math.floor(self._from + n / 2);
    var center = self._buffer[midpoint];
    var i = midpoint;

    if (x > center) {
        i++;
        // insert to the right
        if (self._to === 2 * self._max) {
            self._compact();
            self.insert(x);
            return;
        }
        while (i < self._to) {
            if (self._buffer[i] > x) {
                self._moveRight(i);
                break;
            }
            i++;
        }
        self._buffer[i] = x;
        self._to += 1;
        if (n === self._max) {
            self._from += 1;
        }
    } else {
        i--;
        // insert to the left
        if (self._from === 0) {
            self._compact();
            self.insert(x);
            return;
        }
        while (i >= self._from) {
            if (self._buffer[i] < x) {
                self._moveLeft(i);
                break;
            }
            i--;
        }
        self._buffer[i] = x;
        self._from -= 1;
        if (n === self._max) {
            self._to -= 1;
        }
    }
}

BucketMedian.prototype.estimate = function estimate() {
    var self = this;
    if (self._buffer.length === 0) {
        return 0;
    } else {
        return self._buffer[self._buffer.length / 2];
    }
}

BucketMedian.prototype._moveRight = function _moveRight(i) {
    var self = this;
    for (var j = self._to; j >= i; j--) {
        self._buffer[j] = self._buffer[j - 1];
    }
}

BucketMedian.prototype._moveLeft = function _moveRight(i) {
    var self = this;
    for (var j = self._from - 1; j <= i; j++) {
        self._buffer[j] = self._buffer[j + 1];
    }
}


BucketMedian.prototype._compact = function _compact() {
    var self = this;
    var i;
    var j;
    //console.log('####\nCompact');
    //console.log('Before:\n' + self.toString());

    if (self._from === 0) {
        j = self._max + Math.floor(self._max / 2) - 1;
        for (i = self._max - 1; i >= 0; i-- , j--) {
            self._buffer[j] = self._buffer[i];
        }
    } else {
        j = Math.floor(self._max / 2);
        for (i = self._from; i < self._to; i++ , j++) {
            self._buffer[j] = self._buffer[i];
        }
    }

    self._from = Math.floor(self._max / 2);
    self._to = self._from + self._max;

    //console.log('After:\n' + self.toString() + '\n####');
}

BucketMedian.prototype.toString = function toString() {
    var self = this;
    var str = '';
    var lim = '';
    for (var ii = 0; ii < self._buffer.length; ii++) {
        var y = self._buffer[ii];
        if (y === undefined) {
            str += '. ';
        } else {
            str += y + ' '
        }
        if (ii === self._from) {
            lim += '^ '
        } else if (ii === self._to) {
            lim += '$ '
        } else {
            lim += '  '
        }
    }
    return str + '\n' + lim;
}
