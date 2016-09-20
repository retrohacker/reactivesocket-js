'use strict';

var net = require('net');

var _ = require('lodash');
var assert = require('chai').assert;
var EventEmitter = require('events');

var reactiveSocket = require('../../lib');
var getSemaphore = require('../../lib/common/getSemaphore');

var SERVERS = [];

describe('LoadBalancer', function () {

    function makeFactory(host, port) {
        return {
            apply: function () {
                var res = new EventEmitter();
                var client = net.connect(port, host, function (e) {
                    if (e) {
                        res.emit('error', e);
                    } else {
                        var rs = reactiveSocket.createReactiveSocket({
                            transport: {
                                stream: client,
                                framed: true
                            },
                            type: 'client',
                            metadataEncoding: 'utf-8',
                            dataEncoding: 'utf-8'
                        });
                        res.emit('reactivesocket', rs);
                    }
                });
                return res;
            },
            availability: function () {
                return 1.0;
            },
            name: 'server-' + port
        };
    }

    function createServer(cfg, semaphore) {
        var serverInfo = {
            latencyMs: 0,
            errorRate: 0,
            requestCount: 0
        };

        console.log('Create server ' + JSON.stringify(cfg));
        var server = net.createServer();
        server.listen(cfg, function (err) {
            console.log('Server listening on ' + cfg.port);

            if (err) {
                throw err;
            }

            server.on('connection', function (s) {
                // console.log('Server accepting connection ' + s);
                reactiveSocket.createReactiveSocket({
                    transport: {
                        stream: s,
                        framed: true
                    },
                    type: 'server'
                }).on('error', function (e) {
                    console.err('ERROR: ' + e);
                }).on('request', function (stream) {
                    //console.log('Server receiving request ' + stream);
                    serverInfo.requestCount++;
                    if (Math.random() > serverInfo.errorRate) {
                        console.log('server ' + cfg.port + ' responding with latency ' + serverInfo.latencyMs);
                        if (serverInfo.latencyMs > 0) {
                            setTimeout(function () {
                                stream.response({data: 'wowow-' + cfg.port});
                            }, serverInfo.latencyMs);
                        } else {
                            stream.response({data: 'wowow-' + cfg.port});
                        }
                    }
                });
            });

            server.on('error', function (e) {
                throw e;
            });
            serverInfo.server = server;
            serverInfo.name = 'server-' + (cfg.port - 1337);

            semaphore.latch();
        });
        serverInfo.factory = makeFactory('localhost', cfg.port);

        SERVERS.push(serverInfo);
    }

    beforeEach(function (done) {
        var base = 1337;
        var n = 10;
        var semaphore = getSemaphore(n, done);
        for (var port = base; port < base + n; port++) {
            createServer({port: port, host: 'localhost'}, semaphore);
        }
    });

    afterEach(function () {
        _.forEach(SERVERS, function (info) {
            console.log(JSON.stringify({
                name: info.name,
                requests: info.requestCount,
                latency: info.latencyMs
            }));
            info.server.close();
        });
    });

    it('Empty loadbalancer generate errors', function (done) {
        var emptySource = new EventEmitter();

        var lb = reactiveSocket.createLoadBalancer({
            factorySource: emptySource
        });

        lb.request({data: 'too soon'}).on('error', function (err) {
            assert(true, 'No factories have been added, LB must fail request!');
            done();
        });
    });

    it.only('works', function (done) {
        this.timeout(60 * 1000);
        var source = new EventEmitter();

        var lb = reactiveSocket.createLoadBalancer({
            factorySource: source,
            refreshPeriodMs: 10 * 1000
        });

        SERVERS[0].latencyMs = 1000;
        source.emit('add', SERVERS[0].factory);
        SERVERS[1].latencyMs = 1000;
        source.emit('add', SERVERS[1].factory);
        SERVERS[2].latencyMs = 1000;
        source.emit('add', SERVERS[2].factory);
        SERVERS[3].latencyMs = 1000;
        source.emit('add', SERVERS[3].factory);
        // SERVERS[4].latencyMs = 1000;
        // source.emit('add', SERVERS[4].factory);
        // SERVERS[5].latencyMs = 1000;
        // source.emit('add', SERVERS[5].factory);

        // setTimeout(function () {
        //     source.emit('add', SERVERS[1].factory);
        //     SERVERS[1].latencyMs = 1000;
        // }, 200);

        setTimeout(function () {
            source.emit('add', SERVERS[6].factory);
        }, 2000);

        var n = 100;
        var timer = null;
        var cc = getSemaphore(n, function () {
            if (timer) {
                clearInterval(timer);
            }
            lb.close(done);
        });
        var j = 0;
        lb.on('ready', function () {
            timer = setInterval(function () {
                lb.request({data: 'req-req'}).on('response', function (res) {
                    console.log('receive response ' +
                        JSON.stringify(res.getResponse()));
                }).on('error', function (err) {
                    assert(false, 'We shall not see errors!');
                }).on('terminate', function () {
                    cc.latch();
                });
                j++;
            }, 50);
        });
    });
});
