'use strict';

function FrugalMedian() {
    this._estimate = 0;
    this._step = 1;
    this._sign = 0;
}

module.exports = FrugalMedian;

FrugalMedian.prototype.estimate = function () {
    var self = this;
    return self._estimate;
};

FrugalMedian.prototype.insert = function insert(x) {
    var self = this;

    if (self._sign === 0) {
        self._estimate = x;
        self._sign = 1;
        return;
    }

    if (x > self._estimate) {
        self._step += self._sign;

        if (self._step > 0) {
            self._estimate += self._step;
        } else {
            self._estimate += 1;
        }

        if (self._estimate > x) {
            self._step += (x - self._estimate);
            self._estimate = x;
        }

        if (self._sign < 0) {
            self._step = 1;
        }

        self._sign = 1;
    } else if (x < self._estimate) {
        self._step -= self._sign;

        if (self._step > 0) {
            self._estimate -= self._step;
        } else {
            self._estimate -= 1;
        }

        if (self._estimate < x) {
            self._step += (self._estimate - x);
            self._estimate = x;
        }

        if (self._sign > 0) {
            self._step = 1;
        }

        self._sign = -1;
    }
};
