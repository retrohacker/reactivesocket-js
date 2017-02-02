'use strict';

var assert = require('chai').assert;
var Duplex = require('stream').Duplex;
var util = require('util');

var getSemaphore = require('../../lib/common/getSemaphore');
var ReactiveSocket =
    require('../../lib/connection/reactiveSocket');


function ReadFailingStream(options) {
    Duplex.call(this, options);
}
util.inherits(ReadFailingStream, Duplex);

ReadFailingStream.prototype._read = function readBytes(n) {
    console.log('erroring read');
    this.emit('error', new Error());
};

ReadFailingStream.prototype._write = function (chunk, enc, cb) {
    cb();
};


describe('ReactiveSocket', function () {
    it('Create a ReactiveSocket', function (done) {
        var rs = new ReactiveSocket({
            transport: {
                stream: new ReadFailingStream()
            },
            type: 'client'
        });

        var semaphore = getSemaphore(2, function () {
            assert(rs.availability() === 0.0, 'RS availability is now 0.0');
            done();
        });

        rs.once('error', function (res) {
            semaphore.latch();
        });

        rs.once('close', function (res) {
            semaphore.latch();
        });

        rs.request({data: 'data', metadata: ''}).on('response', function (res) {
            assert(false, 'Shouldn\'t receive a response!');
        });
    });
});
