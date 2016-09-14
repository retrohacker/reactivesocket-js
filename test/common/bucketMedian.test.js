'use strict';

var _ = require('lodash');
var assert = require('chai').assert;
var expect = require('chai').expect;

var getRandomInt = require('./getRandomInt');
var BucketMedian = require('../../lib/common/bucketMedian');
var Median = require('../../lib/common/median');

describe('BucketMedian', function () {

    function measureError() {

        var med = new BucketMedian();
        var streaming = new Median();
        var buffer = [];

        for (var i = 0; i < 100; i++) {
            var x = getRandomInt(10 * 1000, 100 * 1000);
            med.insert(x);
            streaming.insert(x);
            buffer.push(x);
        }

        buffer.sort(function (a, b) { return a - b; });
        var expectedMedian = buffer[Math.floor(buffer.length / 2)];
        var estimatedMedian = med.estimate();
        var streamingEstimation = streaming.estimation();

        // console.log('expected: ' + expectedMedian + ', estimated: ' + estimatedMedian + ', streaming: ' + streamingEstimation);
        var error0 = Math.abs(estimatedMedian - expectedMedian) / expectedMedian;
        var error1 = Math.abs(streamingEstimation - expectedMedian) / expectedMedian;
        return [error0, error1];
    }

    it.only('works', function (done) {
        this.timeout(30000);

        var sum0 = 0;
        var sum1 = 0;
        var n = 1000;
        for(var i = 0; i < n; i++) {
            var errors = measureError();
            console.log(i + ': ' + errors[0].toFixed(3) + ',\t' + errors[1].toFixed(3));
            sum0 += errors[0];
            sum1 += errors[1];
        }
        var avg0 = sum0 / n;
        var avg1 = sum1 / n;
        console.log('avg0: ' + (100 * avg0).toFixed(2) + '%,\tavg1: ' + (100 * avg1).toFixed(2) + '%');
        expect(avg0).to.be.within(0, 0.05);
        done();
    });
});
