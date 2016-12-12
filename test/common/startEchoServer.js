'use strict';

var net = require('net');

var reactiveSocket = require('../../lib');

function startEchoServer(cfg) {
    var server = net.createServer();
    server.listen(cfg.port, cfg.host);
    server.on('connection', function (s) {
        reactiveSocket.createReactiveSocket({
            transport: {
                stream: s,
                framed: true
            },
            type: 'server'
        }).on('error', function (e) {
            console.err('ERROR: ' + e);
        }).on('request', function (stream) {
            var req = stream.getRequest();
            stream.response({data: req.data});
        });
    });
    server.on('error', function (e) {
        throw e;
    });
    return server;
}


module.exports = startEchoServer;
