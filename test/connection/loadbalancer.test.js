'use strict';

var net = require('net');

var _ = require('lodash');
var assert = require('chai').assert;
var EventEmitter = require('events');
var metrix = require('metrix');

var reactiveSocket = require('../../lib');
var getSemaphore = require('../../lib/common/getSemaphore');

var SERVERS = [];

var RECORDER = metrix.createRecorder();
var AGGREGATOR = metrix.createAggregator(RECORDER);

describe('LoadBalancer', function () {

    function makeFactory(host, port) {
        // TODO: add cancellation
        return {
            apply: function () {
                var res = new EventEmitter();
                var client = net.connect(port, host, function () {
                    var rs = reactiveSocket.createReactiveSocket({
                        transport: {
                            stream: client,
                            framed: true
                        },
                        type: 'client',
                        recorder: RECORDER,
                        metadataEncoding: 'utf-8',
                        dataEncoding: 'utf-8'
                    });
                    res.emit('reactivesocket', rs);
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

        console.log(Date.now() + ' Create server ' + JSON.stringify(cfg));
        var server = net.createServer();
        server.listen(cfg, function (err) {
            console.log(Date.now() + ' Server listening on ' + cfg.port);

            if (err) {
                throw err;
            }

            server.on('connection', function (s) {
                // console.log(Date.now() + ' Server accepting connection ' + s);
                reactiveSocket.createReactiveSocket({
                    transport: {
                        stream: s,
                        framed: true
                    },
                    type: 'server'
                }).on('error', function (e) {
                    console.err('ERROR: ' + e);
                }).on('request', function (stream) {
                    //console.log(Date.now() + ' Server receiving request ' + stream);
                    serverInfo.requestCount++;
                    var req = stream.getRequest();
                    if (Math.random() > serverInfo.errorRate) {
                        if (serverInfo.latencyMs > 0) {
                            setTimeout(function () {
                                stream.response({data: 'resp-' + req.data + '-' + cfg.port});
                            }, serverInfo.latencyMs);
                        } else {
                            stream.response({data: 'resp-' + req.data + '-' + cfg.port});
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

    function load(socket, numberOfRequests, rps, done) {
        var n = numberOfRequests;
        var timer = null;
        var semaphore = getSemaphore(n, function () {
            socket.close(done);
        });

        var j = 0;
        timer = setInterval(function () {
            if (j === numberOfRequests && timer) {
                clearInterval(timer);
                return;
            }
            socket.request({data: 'req-' + j}).on('response', function (res) {
                console.log(Date.now() + ' receive response ' +
                    JSON.stringify(res.getResponse()));
            }).on('error', function (err) {
                console.log(Date.now() + ' error ' + JSON.stringify(err, null, 2));
            }).on('terminate', function () {
                semaphore.latch();
            });
            j++;
        }, 1000 / rps);
    }

    beforeEach(function (done) {
        var base = 2000;
        var n = 10;
        var semaphore = getSemaphore(n, done);
        for (var port = base; port < base + n; port++) {
            createServer({port: port, host: 'localhost'}, semaphore);
        }
        AGGREGATOR.clear();
    });

    afterEach(function () {
        console.log('*** Existing test, cleanup ***')
        _.forEach(SERVERS, function (info) {
            console.log(JSON.stringify({
                name: info.name,
                requests: info.requestCount,
                latency: info.latencyMs
            }));
            console.log('*** cleanup: closing server ' + info.server.name + ' ***')
            info.server.close();
        });
        SERVERS = [];

        var report = AGGREGATOR.report();
        var json = JSON.stringify(report, null, 2);
        console.log(json)
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

    it('deal with closing servers', function (done) {
        this.timeout(10 * 1000);
        var source = new EventEmitter();
        var lb = reactiveSocket.createLoadBalancer({
            factorySource: source,
            refreshPeriodMs: 1000,
            initialAperture: 5,
            recorder: RECORDER
        });

        source.emit('add', SERVERS[0].factory);
        source.emit('add', SERVERS[1].factory);
        source.emit('add', SERVERS[2].factory);

        lb.on('ready', function () {
            load(lb, 10, 100, function () {
                SERVERS[0].server.close();
                SERVERS[0].server.close();

                load(lb, 10, 100, function () {
                    done();
                });
            });
        });
    });

    it('increase aperture when necessary', function (done) {
        this.timeout(10 * 1000);
        var source = new EventEmitter();
        var lb = reactiveSocket.createLoadBalancer({
            factorySource: source,
            refreshPeriodMs: 500,
            initialAperture: 1, // low initial aperture, should converge to 3
            recorder: RECORDER
        });

        // Setup 5 servers of identicall latency characteristics
        SERVERS[0].latencyMs = 50;
        source.emit('add', SERVERS[0].factory);
        SERVERS[1].latencyMs = 50;
        source.emit('add', SERVERS[1].factory);
        SERVERS[2].latencyMs = 50;
        source.emit('add', SERVERS[2].factory);
        SERVERS[3].latencyMs = 50;
        source.emit('add', SERVERS[3].factory);
        SERVERS[4].latencyMs = 50;
        source.emit('add', SERVERS[4].factory);

        lb.on('ready', function () {
            load(lb, 200, 90, function () {
                var report = AGGREGATOR.report();
                // 50ms latency is 1000/50 ~= 20 RPS per server
                // 3 servers is enough handle between 3 * 20 * 1 = 60
                // and 3 * 20 * 2 = 120 RPS
                assert.equal(report.counters['loadbalancer/aperture'], 3);
                done();
            });
        });
    });

    it('decrease aperture when necessary', function (done) {
        this.timeout(10 * 1000);
        var source = new EventEmitter();

        var lb = reactiveSocket.createLoadBalancer({
            factorySource: source,
            refreshPeriodMs: 500,
            initialAperture: 6, // high initial aperture, should converge to 3
            recorder: RECORDER
        });

        // Setup 5 servers of identicall latency characteristics
        SERVERS[0].latencyMs = 50;
        source.emit('add', SERVERS[0].factory);
        SERVERS[1].latencyMs = 50;
        source.emit('add', SERVERS[1].factory);
        SERVERS[2].latencyMs = 50;
        source.emit('add', SERVERS[2].factory);
        SERVERS[3].latencyMs = 50;
        source.emit('add', SERVERS[3].factory);
        SERVERS[4].latencyMs = 50;
        source.emit('add', SERVERS[4].factory);

        lb.on('ready', function () {
            load(lb, 200, 90, function () {
                var report = AGGREGATOR.report();
                // 50ms latency is 1000/50 ~= 20 RPS per server
                // 3 servers is enough handle between 3 * 20 * 1 = 60
                // and 3 * 20 * 2 = 120 RPS
                assert.equal(report.counters['loadbalancer/aperture'], 3);
                done();
            });
        });
    });

    it.only('evict failing factories', function (done) {
        this.timeout(10 * 1000);
        var source = new EventEmitter();

        var lb = reactiveSocket.createLoadBalancer({
            factorySource: source,
            refreshPeriodMs: 100,
            recorder: RECORDER
        });

        var badFactory = {
            apply: function () {
                var emitter = new EventEmitter();
                setTimeout(function () {
                    emitter.emit('error', 'kaboom!');
                }, 100);
                return emitter;
            },
            availability: function () { return 1.0; },
            name: 'bad factory'
        };
        source.emit('add', badFactory);
        source.emit('add', badFactory);
        source.emit('add', badFactory);

        SERVERS[0].latencyMs = 100;
        source.emit('add', SERVERS[0].factory);
        SERVERS[1].latencyMs = 100;
        source.emit('add', SERVERS[1].factory);
        SERVERS[2].latencyMs = 100;
        source.emit('add', SERVERS[2].factory);

        lb.on('ready', function () {
            load(lb, 10, 5, function () {
                var report = AGGREGATOR.report();
                assert.equal(
                    report.counters['loadbalancer/connect_exception'], 3);
                assert.equal(
                    report.counters['connection/requests'],
                    report.counters['connection/responses'])
                done();
            });
        });
    });

    it('favor fast server above slow ones', function (done) {
        this.timeout(10 * 1000);
        var source = new EventEmitter();

        var lb = reactiveSocket.createLoadBalancer({
            factorySource: source,
            refreshPeriodMs: 1 * 1000,
            recorder: RECORDER
        });

        SERVERS[0].latencyMs = 100;
        source.emit('add', SERVERS[0].factory);
        SERVERS[1].latencyMs = 100;
        source.emit('add', SERVERS[1].factory);
        SERVERS[2].latencyMs = 100;
        source.emit('add', SERVERS[2].factory);
        SERVERS[3].latencyMs = 100;
        source.emit('add', SERVERS[3].factory);
        SERVERS[4].latencyMs = 100;
        source.emit('add', SERVERS[4].factory);
        SERVERS[5].latencyMs = 100;
        source.emit('add', SERVERS[5].factory);

        // Fast one which should receive most of the requests
        source.emit('add', SERVERS[6].factory);

        lb.on('ready', function () {
            load(lb, 100, 20, function () {
                // Server 6 should have received most of the requests
                assert(SERVERS[6].requestCount > 20 * SERVERS[0].requestCount);
                assert(SERVERS[6].requestCount > 20 * SERVERS[1].requestCount);
                assert(SERVERS[6].requestCount > 20 * SERVERS[2].requestCount);
                assert(SERVERS[6].requestCount > 20 * SERVERS[3].requestCount);
                assert(SERVERS[6].requestCount > 20 * SERVERS[4].requestCount);
                assert(SERVERS[6].requestCount > 20 * SERVERS[5].requestCount);

                done();
            });
        });
    });
});
