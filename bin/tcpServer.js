#!/usr/bin/env node
'use strict';

var net = require('net');

var reactiveSocket = require('../lib');

var PORT = process.env.PORT || 1337;
var HOST = process.env.HOST || 'localhost';

var COUNT = 0;
var TCP_SERVER = net.createServer(function (con) {
    con.on('error', function (err) {
        console.error('tcp con error', err);
    });
    var RS_SERVER_CON = reactiveSocket.createConnection({
        transport: {
            stream: con,
            framed: true
        },
        type: 'server'
    });
    RS_SERVER_CON.on('request', function (stream) {
        COUNT++;
        setImmediate(function () {
            stream.response({
                metadata: stream.getRequest().metadata,
                data: stream.getRequest().data
            });
        });
    });
});

TCP_SERVER.listen({
    port: PORT,
    host: HOST
}, function (err) {
    if (err) {
        throw err;
    }
});

setInterval(function () {
    if (COUNT === 0) {
        return;
    }
    console.error('%s RPS', COUNT);
    COUNT = 0;
}, 1000);
