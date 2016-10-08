#!/usr/bin/env node
'use strict';

var readline = require('readline')

var SlidingMedian = require('../lib/common/slidingMedian');
var Ewma = require('../lib/common/ewma');


var lineReader = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});

var time = 0;
var lineClock = {
    now: function () { return time; }
}

var size = 48;
var median = new SlidingMedian({
    clock: lineClock,
    size: size,
    window: 5000
})

var ewma = new Ewma(1000, 1, lineClock);
var buf = new Array(size);
var i = 0;
lineReader.on('line', function (line) {
    var res = line.split(' ');
    var latency = parseInt(res[1], 10);
    time = res[0];
    median.insertOne(latency);
    ewma.insert(latency)
    buf[i % size] = latency;
    var x = median.estimate();

    var buf2 = buf.slice();
    buf2.sort(function (a, b) { return a - b; });
    var mid = Math.min(i / 2 >> 0, (buf2.length / 2) >> 0);

    console.log(time + ' ' + latency
        + ' ' + x
        + ' ' + buf2[mid]
        + ' ' + ewma.value()
    );
    i++;
});
