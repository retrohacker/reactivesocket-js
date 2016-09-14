'use strict';

var _ = require('lodash');
var assert = require('chai').assert;
var expect = require('chai').expect;

var getRandomInt = require('./getRandomInt');
var BucketMedian = require('../../lib/common/bucketMedian');

describe('BucketMedian', function () {

    function measureError() {
        var med = new BucketMedian(128);
        var buffer = [];

        for (var i = 0; i < 100; i++) {
            var x = getRandomInt(1000, 10000);
            med.insert(x);
            buffer.push(x);
        }

        buffer.sort(function (a, b) { return a - b; });
        var expectedMedian = buffer[Math.floor(buffer.length / 2)];
        var estimatedMedian = med.estimate();

        // console.log('expected: ' + expectedMedian + ', estimated: ' + estimatedMedian);
        return Math.abs(estimatedMedian - expectedMedian) / expectedMedian;
    }

    it.only('works', function (done) {
        this.timeout(21000);

        var sum = 0;
        var n = 500;
        for(var i = 0; i < n; i++) {
            var error = measureError();
            console.log(i + ': ' + error);
            sum += error;
        }
        var avg = sum / n;
        console.log('avg: ' + avg);
        expect(avg).to.be.within(0, 0.5);
        done();
    });
});
