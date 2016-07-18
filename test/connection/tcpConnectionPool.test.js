'use strict';

var fs = require('fs');
var net = require('net');

var _ = require('lodash');
var assert = require('chai').assert;
var bunyan = require('bunyan');

var reactiveSocket = require('../../lib');

var ERROR_CODES = reactiveSocket.ERROR_CODES;

var PORT = process.env.PORT || 1337;
var HOST = process.env.HOST || 'localhost';

var SERVER_CFG = [{
    port: PORT,
    host: HOST
},{
    port: ++PORT,
    host: HOST
}, {
    port: ++PORT ,
    host: HOST
}, {
    port: ++PORT,
    host: HOST
}, {
    port: ++PORT,
    host: HOST
}, {
    port: ++PORT,
    host: HOST
}, {
    port: ++PORT,
    host: HOST
}, {
    port: ++PORT,
    host: HOST
}, {
    port: ++PORT,
    host: HOST
}, {
    port: ++PORT,
    host: HOST
}, {
    port: ++PORT,
    host: HOST
}];

describe('TcpConnectionPool', function () {

    var LOG = bunyan.createLogger({
        name: 'tcp connection pool tests',
        level: process.env.LOG_LEVEL || bunyan.INFO,
        serializers: bunyan.stdSerializers,
        src: true
    });

    LOG.addSerializers({
        buffer: function (buf) {
            return buf.toString();
        }
    });

    var SERVERS = {};
    var SERVER_CONNECTIONS = [];
    var CONNECTION_POOL;
    var SERVER_CONNECTION_COUNT = 0;

    beforeEach(function (done) {
        var count = 0;
        _(SERVER_CFG).forEach(function (cfg) {
            var server = net.createServer();
            server.listen(cfg, function (err) {
                if (err) {
                    throw err;
                }
                count++;
                SERVERS[cfg.host + ':' + cfg.port] = server;
                if (count === _.keys(SERVER_CFG).length) {
                    done();
                }
                server.on('connection', function (s) {
                    SERVER_CONNECTIONS.push(s);
                    SERVER_CONNECTION_COUNT++;
                    reactiveSocket.createConnection({
                        log: LOG,
                        transport: {
                            stream: s,
                            framed:true
                        },
                        type: 'server'
                    }).on('error', function (err) {
                        console.log('XXX yunong', err);
                    });
                });

                server.on('error', function (e) {
                    throw e;
                });
            });
        });
    });

    afterEach(function (done) {
        this.timeout(123123123);
        SERVER_CONNECTION_COUNT = 0;
        var count = 0;
        _(SERVERS).forEach(function (s) {
            s.close(function () {
                console.log('XXX', count);
                count++;
                if (count === _.keys(SERVER_CFG).length) {
                    //done();
                }
            });
        });

        SERVER_CONNECTIONS.forEach(function (s) {
            s.destroy();
        });
    });

    it.only('should create a connection pool', function (done) {
        this.timeout(10000000);
        CONNECTION_POOL = reactiveSocket.createTcpConnectionPool({
            size: 3,
            log: LOG,
            hosts: SERVER_CFG
        });

        CONNECTION_POOL.on('ready', done);
    });
});
