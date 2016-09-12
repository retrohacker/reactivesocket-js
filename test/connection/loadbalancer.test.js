'use strict';

var net = require('net');

var _ = require('lodash');
var assert = require('chai').assert;
var EventEmitter = require('events');

var reactiveSocket = require('../../lib');
var getSemaphore = require('../../lib/common/getSemaphore');

var PORT = process.env.PORT || 2337;
var HOST = process.env.HOST || 'localhost';

describe('LoadBalancer', function () {

    function createServer(cfg, semaphore) {
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
                    console.err("ERROR: " + e);
                }).on('request', function (stream) {
                    //console.log('Server receiving request ' + stream);
                    setTimeout(function () {
                        stream.response({data: "wowow-" + cfg.port});
                    }, 100 * (1 + Math.random()));
                });
            });

            server.on('error', function (e) {
                throw e;
            });

            semaphore.latch();
        });
    }


    beforeEach(function (done) {
        var semaphore = getSemaphore(2, done);
        createServer({port: 2337, host: HOST}, semaphore);
        createServer({port: 2338, host: HOST}, semaphore);
    });


    it('works', function (done) {
        this.timeout(21000);
        var source = new EventEmitter();

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
                }
            }
        }

        var factory0 = makeFactory(HOST, 2337);
        var factory1 = makeFactory(HOST, 2338);

        var lb = reactiveSocket.createLoadBalancer({
            factorySource: source,
            refreshPeriodMs: 500
        });

        lb.request({data: 'too soon'}).on('error', function (err) {
            assert(true, 'No factories have been added, LB must fail request!');
        });

        source.emit('add', factory0);
        source.emit('add', factory1);

        var n = 200;
        var timer = null;
        var cc = getSemaphore(n, function () {
            if (timer) {
                clearInterval(timer);
            }
            done();
        });
        var j = 0;
        lb.on('ready', function () {
            timer = setInterval(function () {
                lb.request({data: 'req-req'}).on('response', function (res) {
                    console.log('receive response ' + JSON.stringify(res.getResponse()));
                }).on('error', function (err) {
                    assert(false, 'We shall not see errors!');
                }).on('terminate', function () {
                    cc.latch();
                });
                j++;
            }, 50);
        });
    })
});
