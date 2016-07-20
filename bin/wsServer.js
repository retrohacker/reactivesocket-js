#!/usr/bin/env node
'use strict';

var Ws = require('ws');
var WSStream = require('yws-stream');

var reactiveSocket = require('../lib');

var PORT = process.env.PORT || 1337;
var HOST = process.env.HOST || 'localhost';

var COUNT = 0;
var WS_SERVER = new Ws.Server({port: PORT, host: HOST});

WS_SERVER.on('listening', function () {
    WS_SERVER.on('connection', function (socket) {
        socket.on('error', function (err) {
            console.error('ws con error', err);
        });
        var RS_SERVER_CON = reactiveSocket.createConnection({
            transport: {
                stream: new WSStream({
                    ws: socket
                }).on('error', function (err) {
                    console.error('ws stream error', err);
                })
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
});

setInterval(function () {
    if (COUNT === 0) {
        return;
    }
    console.error('%s RPS', COUNT);
    COUNT = 0;
}, 1000);
