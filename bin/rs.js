#!/usr/bin/env node
'use strict';

var net = require('net');
var url = require('url');

var _ = require('lodash');
var dashdash = require('dashdash');
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
}, {
    names: ['operation', 'o'],
    type: 'string',
    help: 'The Reactive Socket operation.'
}, {
    names: ['metadata', 'm'],
    type: 'string',
    help: 'Metadata to include, defaults to null'
}, {
    names: ['encoding', 'e'],
    type: 'string',
    help: 'Encoding, defaults to utf-8'
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

if (!OPTS.operation || !RAW_URL) {
    HELP = PARSER.help({includeEnv: true}).trimRight();
    help(1);
}

var OPERATION = OPTS.operation.toUpperCase();
var ENDPOINT = url.parse(RAW_URL);
var ENCODING = OPTS.encoding || 'utf8';

var DATA = OPTS._args[1];

var REQ = {
    metadata: OPTS.metadata,
    data: DATA
};

var RS_CLIENT_CON;
var CLIENT_STREAM;

vasync.pipeline({funcs: [
    function setupTransportStream(ctx, cb) {
        if (TCP_REGEX.test(RAW_URL)) {
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
    function getData(ctx, cb) {
        if (!DATA) {
            process.stdin.on('data', function (chunk) {
                DATA += chunk.toString(ENCODING);
            });

            process.stdin.on('end', function () {
                cb();
            });

            process.stdin.resume();
            process.stdin.setEncoding(ENCODING);
        } else {
            cb();
        }
    },
    function setupConnection(ctx, cb) {
        RS_CLIENT_CON = reactiveSocket.createConnection({
            transport: {
                stream: CLIENT_STREAM,
                framed: true
            },
            type: 'client',
            metadataEncoding: 'utf-8',
            dataEncoding: 'utf-8'
        });

        RS_CLIENT_CON.on('ready', function () {
            return cb();
        });
    },
    function operation(ctx, cb) {
        switch (OPERATION) {
            case 'REQ':
                reqRes(cb);
                break;
            default:
                console.error('operation %s not supported', OPERATION);
                process.exit(1);
        }
    }
], arg: {}}, function (err, cb) {
    if (err) {
        throw err;
    }

    process.exit();
});


// Private funcs


function reqRes(cb) {
    cb = _.once(cb);
    var stream = RS_CLIENT_CON.request(REQ);
    stream.on('response', function (res) {
        console.log(res.getResponse());
        return cb();
    });

    stream.on('error', function (err) {
        console.log(err);
        return cb();
    });
}

function help(statusCode) {
    HELP = PARSER.help({includeEnv: true}).trimRight();
    console.log('usage: rs [OPTIONS] tcp|ws://localhost:1337 data\n'
        + 'options:\n'
        + HELP + '\n'
        + 'you can alternatively pipe in data on stdin: \n'
        + 'e.g. echo \'foobar\' | xargs rs -o req tcp://localhost:1337');
    process.exit(statusCode);
}
