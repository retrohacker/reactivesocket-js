'use strict';

var assert = require('chai').assert;
var expect = require('chai').expect;

var getRandomInt = require('./getRandomInt');
var SlidingMedian = require('../../lib/common/slidingmedian');
var FrugalMedian = require('../../lib/common/frugalMedian');

describe('Sliding Median', function () {

    it('Empty Median returns 0', function () {
        var slidingMedian = new SlidingMedian();
        assert.equal(0, slidingMedian.estimate());
    });

    it('Single value median returns it', function () {
        var slidingMedian = new SlidingMedian();
        var x = getRandomInt(0, 100);
        slidingMedian.insert(x);
        assert.equal(x, slidingMedian.estimate());
    });

    function testSlidingMedian(rps, windowMs, bufferSize, n, errorRange) {
        assert.isAtLeast(n, bufferSize,
            'You need to provide enough data to fill at least the buffer');

        var slidingMedian = new SlidingMedian(bufferSize);

        var i;

        for (i = 0; i < n; i++) {
            slidingMedian.insert(getRandomInt(0, 1000));
        }

        var buf = new Array(bufferSize);

        for (i = 0; i < n; i++) {
            var x = getRandomInt(100 * 1000, 1000 * 1000);
            slidingMedian.insert(x);
            buf[i % bufferSize] = x;
        }
        buf.sort(function (a, b) {
            return a - b;
        });
        var expected = buf[(buf.length / 2) >> 0];
        var median = slidingMedian.estimate();
        var error = (100 * Math.abs(median - expected) / expected);
        // console.log('median: ' + median + ', expected: ' + expected
        //     + ', error: ' + error.toFixed(2) + '%');
        return error;
    }

    it('median should be representative of the window', function () {
        this.timeout(30 * 1000);

        var avgError = 0;

        for (var i = 0; i < 100; i++) {
            avgError += testSlidingMedian(25, 500, 128, 200, 50);
        }
        avgError /= 100;

        console.log('Average median estimation error ' + avgError + '%');
        expect(avgError).to.be.within(0, 15);
    });

    function compareError() {
        var slidingMedian = new SlidingMedian();
        var frugalMedian = new FrugalMedian();
        var buffer = [];

        for (var i = 0; i < 300; i++) {
            var x = getRandomInt(10 * 1000, 1000 * 1000);
            slidingMedian.insert(x);
            frugalMedian.insert(x);
            buffer.push(x);
        }

        buffer.sort(function (a, b) {
            return a - b;
        });
        var expectedMedian = buffer[Math.floor(buffer.length / 2)];
        var estimatedMedian = slidingMedian.estimate();
        var streamingEstimation = frugalMedian.estimate();

        var error0 = Math.abs(estimatedMedian - expectedMedian);
        error0 /= expectedMedian;
        var error1 = Math.abs(streamingEstimation - expectedMedian);
        error1 /= expectedMedian;
        return [error0, error1];
    }

    it('Error rate with low number of entries is within acceptable bounds',
        function () {
            var sum0 = 0;
            var sum1 = 0;
            var n = 5;

            for (var i = 0; i < n; i++) {
                var errors = compareError();
                // console.log(i + ': ' + errors[0].toFixed(3) +
                //     ',\t' + errors[1].toFixed(3));
                sum0 += errors[0];
                sum1 += errors[1];
            }
            var avg0 = sum0 / n;
            var avg1 = sum1 / n;
            console.log('Sliding Median Error: ' + (100 * avg0).toFixed(2) +
                '%,\tFrugal Median Error: ' + (100 * avg1).toFixed(2) + '%');
            expect(avg0).to.be.within(0, 0.15);
            // expect(avg1).to.be.within(0, 0.50);
        });
});
