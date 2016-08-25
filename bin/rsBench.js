#!/usr/bin/env node
'use strict';

var fs = require('fs');
var net = require('net');
var url = require('url');

var _  = require('lodash');
var async = require('async');
var dashdash = require('dashdash');
var metrix = require('metrix');
var vasync = require('vasync');

var Ws = require('ws');
var WSStream = require('yws-stream');

var reactiveSocket = require('../lib');

var TCP_REGEX = /tcp:\/\/.+:[0-9]+\/*.*/;
var WS_REGEX = /wss?:\/\/.+:[0-9]+\/*.*/;

var OPTIONS = [{
    names: ['help', 'h'],
    type: 'bool',
    help: 'Print this help and exit.'
},{
    names: ['number', 'n'],
    type: 'number',
    help: 'Number of requests to perform'
}, {
    names: ['concurrency', 'c'],
    type: 'number',
    help: 'Number of multiple requests to make at a time'
}, {
    names: ['size', 's'],
    type: 'number',
    help: 'Size of payload in bytes, defaults to 8'
}, {
    names: ['metadata', 'm'],
    type: 'string',
    help: 'Metadata to include, defaults to null'
}];

var PARSER = dashdash.createParser({options: OPTIONS});
var HELP = PARSER.help({includeEnv: true}).trimRight();
var OPTS;

try {
    OPTS = PARSER.parse(process.argv);
} catch (e) {
    console.error('foo: error: %s', e.message);
    process.exit(1);
}

if (OPTS.help) {
    help(0);
}


var RAW_URL = OPTS._args[0];

if (!RAW_URL) {
    help(1);
}
var ENDPOINT = url.parse(RAW_URL);
var ITERATIONS = OPTS.number || 1000;
var CONCURRENCY = OPTS.concurrency || 10;
var SIZE = OPTS.size || 8;

var DATA = fs.readFileSync('./test/etc/hamlet.txt', 'utf8');

for (var i = 0; i < SIZE / DATA.length ; i++) {
    DATA += DATA;
}

DATA = DATA.substr(0, SIZE);

var REQ = {
    metadata: OPTS.metadata,
    data: DATA
};

var COUNT = 0;

var START_TIME;

var RS_CLIENT_CON;
var CLIENT_STREAM;


// var RECORDER = metrix.recorder.DISABLE;
var RECORDER = metrix.createRecorder();
var AGGREGATOR = metrix.createAggregator(RECORDER);

var TCP_CONNECT_LATENCY = RECORDER.timer('tcp_connect_latency_ms');
var TCP_CONNECT_LATENCY_ID = 0;

vasync.pipeline({funcs: [
    function setupTransportStream(ctx, cb) {
        if (TCP_REGEX.test(RAW_URL)) {
            TCP_CONNECT_LATENCY_ID = TCP_CONNECT_LATENCY.start();
            CLIENT_STREAM = net.connect(ENDPOINT.port, ENDPOINT.hostname,
                                        function (e) {
                return cb(e);
            });
        } else if (WS_REGEX.test(RAW_URL)) {
            var ws = new Ws(RAW_URL);
            CLIENT_STREAM = new WSStream({
                ws: ws
            });

            ws.on('open', function () {
                return cb();
            });

        } else {
            help(1);
        }
    },
    function setupConnection(ctx, cb) {
        TCP_CONNECT_LATENCY.stop(TCP_CONNECT_LATENCY_ID);
        RS_CLIENT_CON = reactiveSocket.createConnection({
            transport: {
                stream: CLIENT_STREAM,
                framed: true
            },
            recorder: RECORDER,
            type: 'client',
            metadataEncoding: 'utf-8',
            dataEncoding: 'utf-8'
        });

        RS_CLIENT_CON.on('ready', function () {
            START_TIME = process.hrtime();
            async.eachLimit(_.range(ITERATIONS), CONCURRENCY,
                function (timer, _cb) {
                    var stream = RS_CLIENT_CON.request(REQ);

                    stream.on('response', function (res) {
                        COUNT++;
                        _cb();

                        if (COUNT === ITERATIONS) {
                            return cb();
                        }
                    });
                });
        });
    }
], arg: {}}, function (err, cb) {
    if (err) {
        throw err;
    }

    process.exit();
});

process.on('exit', function () {
    var report = AGGREGATOR.report();
    console.log(JSON.stringify(report, null, 2));

    var elapsed = process.hrtime(START_TIME);
    var elapsedNs = elapsed[0] * 1e9 + elapsed[1];
    var results = {
        'elapsed time (s)': elapsedNs / 1e9,
        'total reqs': COUNT,
        RPS: COUNT / (elapsedNs / 1e9)
    };
    console.error(JSON.stringify(results, null, 2));
});

process.on('SIGINT', function () {
    process.exit();
});

/// Private funcs

function help(statusCode) {
    HELP = PARSER.help({includeEnv: true}).trimRight();
    console.log('usage: rb [OPTIONS] tcp|ws://localhost:1337\n'
                + 'options:\n'
                + HELP);
    process.exit(statusCode);
}
