#!/usr/bin/env node
'use strict';

var EventEmitter = require('events');
var bunyan = require('bunyan');

var _ = require('lodash');
var metrix = require('metrix');

var reactivesocket = require('../lib');

var RECORDER = metrix.createRecorder({
    separator: '.'
});
var AGGREGATOR = metrix.createAggregator(RECORDER);

setInterval(function () {
    var report = AGGREGATOR.report();
    console.log(JSON.stringify(report, null, 2));
}, 30000);

var LOG = bunyan.createLogger({
    name: 'rsl-client',
    level: process.env.LOG_LEVEL || bunyan.INFO
});


var factorySource = new EventEmitter();
var lb = reactivesocket.createLoadBalancer({
    refreshPeriodMs: 1000,
    factorySource: factorySource,
    recorder: RECORDER,
    log: LOG
});

_.forEach([1337, 1338, 1339, 1340, 1341], function (port) {
    var factory = reactivesocket.createReactiveSocketFactory({
        host: '127.0.0.1',
        port: port,
        keepalive: 1000,
        log: LOG
    });
    factorySource.emit('add', factory);
});

var count = 100;

function start (loadbalancer) {
    loadbalancer.request({
        data: 'Hello!',
        metadata: 'XXX'
    }).on('response', function () {
        setTimeout(function () {
            if (count > 0) {
                count--;
                start(loadbalancer);
            }
        }, 1000);
    }).on('error', function () {
        setTimeout(function () {
            if (count > 0) {
                count--;
                start(loadbalancer);
            }
        }, 1000);
    });
}

LOG.info('Starting LB...');
lb.on('ready', function () {
    LOG.info('C\'est parti mon kiki!!!');
    start(lb);
});
