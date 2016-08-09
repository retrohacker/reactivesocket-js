'use strict';

var net = require('net');

var _ = require('lodash');
var assert = require('chai').assert;

var reactiveSocket = require('../../lib');

var ERROR_CODES = reactiveSocket.ERROR_CODES;
var LOG = require('../common/log');

var PORT = process.env.PORT || 1337;
var HOST = process.env.HOST || 'localhost';
var POOL_SIZE = 5;

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

var EXTRA_SERVER_CFG = [{
    host: HOST,
    port: ++PORT
}, {
    host: HOST,
    port: ++PORT
}, {
    host: HOST,
    port: ++PORT
}, {
    host: HOST,
    port: ++PORT
}, {
    host: HOST,
    port: ++PORT
}, {
    host: HOST,
    port: ++PORT
}, {
    host: HOST,
    port: ++PORT
}];

var EXPECTED_REQ = {
    data: 'so much trouble in the world',
    metadata: 'can\'t nobody feel your pain'
};

var EXPECTED_ERROR_REQ = {
    data: 'ERROR'
};

var EXPECTED_RES = {
    data: 'The world\'s changin everyday, times moving fast',
    metadata: 'My girl said I need a raise, how long will she last?'
};

var EXPECTED_APPLICATION_ERROR = {
    errorCode: ERROR_CODES.APPLICATION_ERROR,
    metadata: 'You gave them all those old time stars',
    data: 'Through wars of worlds - invaded by Mars'
};

describe('TcpLoadBalancer', function () {
    var SERVERS = {};
    var SERVER_CONNECTIONS = [];
    var CONNECTION_POOL;
    var SERVER_CONNECTION_COUNT = 0;

    function createServer(cfg, cb) {
        var server = net.createServer();
        server.listen(cfg, function (err) {
            if (err) {
                throw err;
            }
            SERVERS[cfg.host + ':' + cfg.port] = server;

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
                }).on('error', function (e) {
                }).on('request', function (stream) {
                    if (stream.getRequest().data ===
                        EXPECTED_ERROR_REQ.data) {

                        stream.error(
                            _.cloneDeep(EXPECTED_APPLICATION_ERROR));
                    } else {
                        // slight delay here so that we can simulate errors
                        setTimeout(function () {
                            stream.response(_.cloneDeep(EXPECTED_RES));
                        }, 500);
                    }
                });
            });

            server.on('error', function (e) {
                throw e;
            });

            cb();
        });
    }

    beforeEach(function (done) {
        var count = 0;
        _.concat(SERVER_CFG, EXTRA_SERVER_CFG).forEach(function (cfg) {
            createServer(cfg, function () {
                count++;

                if (count === _.keys(SERVER_CFG).length) {
                    done();
                }
            });
        });
    });

    afterEach(function (done) {
        CONNECTION_POOL.close();
        SERVER_CONNECTION_COUNT = 0;
        var count = 0;
        _(SERVERS).forEach(function (s) {
            s.close(function () {
                count++;

                if (count === _.keys(SERVER_CFG).length) {
                    done();
                }
            });
        });

        SERVER_CONNECTIONS.forEach(function (s) {
            s.end();
        });
    });

    it('should create a connection pool', function (done) {
        CONNECTION_POOL = reactiveSocket.createTcpLoadBalancer({
            size: POOL_SIZE,
            log: LOG,
            hosts: SERVER_CFG
        });

        var isReady;
        CONNECTION_POOL.on('ready', function () {
            isReady = true;
        });
        CONNECTION_POOL.on('connected', function () {
            assert.ok(isReady, 'ready event did not fire');
            checkPool(CONNECTION_POOL);
            return done();
        });
    });

    it('should tolerate connection failure', function (done) {
        CONNECTION_POOL = reactiveSocket.createTcpLoadBalancer({
            size: POOL_SIZE,
            log: LOG,
            hosts: SERVER_CFG
        });

        CONNECTION_POOL.on('connected', function () {
            CONNECTION_POOL.on('connect', function () {
                checkPool(CONNECTION_POOL);
                done();
            });
            CONNECTION_POOL.getConnection()._transportStream.end();
        });
    });

    it('should tolerate multiple connection failures', function (done) {
        CONNECTION_POOL = reactiveSocket.createTcpLoadBalancer({
            size: POOL_SIZE,
            log: LOG,
            hosts: SERVER_CFG
        });

        CONNECTION_POOL.on('connected', function () {
            var reconnectCount = 0;
            CONNECTION_POOL.on('connect', function () {
                reconnectCount++;

                if (reconnectCount === POOL_SIZE) {
                    checkPool(CONNECTION_POOL);
                    done();
                }
            });
            _.forEach(CONNECTION_POOL._connections.connected, function (c) {
                c._tcpConn.end();
            });
        });
    });

    it('should update hosts with new hosts', function (done) {
        CONNECTION_POOL = reactiveSocket.createTcpLoadBalancer({
            size: POOL_SIZE,
            log: LOG,
            hosts: SERVER_CFG
        });

        var updatedHosts = _.cloneDeep(EXTRA_SERVER_CFG);

        CONNECTION_POOL.on('connected', function () {
            var connections = CONNECTION_POOL._connections;
            var connected = connections.connected;
            var connection = _.keys(connected)[0];
            updatedHosts.push(connected[connection]._connOpts);
            var updatedHostKeys = [];
            _.forEach(updatedHosts, function (h) {
                updatedHostKeys.push(h.host + ':' + h.port);
            });

            CONNECTION_POOL.updateHosts(updatedHosts);
            CONNECTION_POOL.on('connect', function () {
                if (_.keys(connected).length === POOL_SIZE) {
                    assert.ok(connected[connection],
                              'live connection that spans previous and ' +
                                  'current hosts should still be connected');
                    // verify that pool only contains connections from the
                    // updated list
                    var connectedKeys = _.keys(connected);
                    assert.equal(connectedKeys.length, POOL_SIZE,
                                 'connected pool size should be the same');
                    _.forEach(connectedKeys, function (k) {
                        assert.ok(_.findIndex(updatedHostKeys, k),
                                  'host ' + k + ' does not exist in host list');
                    });
                    var connectingKeys = _.keys(connections.connecting);
                    _.forEach(connectingKeys, function (k) {
                        assert.ok(_.findIndex(updatedHostKeys, k),
                                  'host ' + k + ' does not exist in host list');
                    });
                    var freeKeys = _.keys(connections.free);
                    _.forEach(freeKeys, function (k) {
                        assert.ok(_.findIndex(updatedHostKeys, k),
                                  'host ' + k + ' does not exist in host list');
                    });
                    checkPool(CONNECTION_POOL);
                    done();
                }
            });
        });
    });

    it('should update hosts with same hosts', function (done) {
        CONNECTION_POOL = reactiveSocket.createTcpLoadBalancer({
            size: POOL_SIZE,
            log: LOG,
            hosts: SERVER_CFG
        });

        var updatedHosts = _.cloneDeep(EXTRA_SERVER_CFG);

        CONNECTION_POOL.on('connected', function () {
            var connections = CONNECTION_POOL._connections;
            var connected = connections.connected;
            var connection = _.keys(connected)[0];
            updatedHosts.push(connected[connection]._connOpts);
            var updatedHostKeys = [];
            _.forEach(updatedHosts, function (h) {
                updatedHostKeys.push(h.host + ':' + h.port);
            });

            CONNECTION_POOL.updateHosts(SERVER_CFG);
            CONNECTION_POOL.on('connect', function () {
                assert.fail('should not emit connect event');
            });

            // lame way to wait for reconnect
            setTimeout(function () {
                assert.ok(connected[connection],
                          'live connection that spans previous and ' +
                              'current hosts should still be connected');
                // verify that pool only contains connections from the
                // updated list
                var connectedKeys = _.keys(connected);
                assert.equal(connectedKeys.length, POOL_SIZE,
                             'connected pool size should be the same');
                _.forEach(connectedKeys, function (k) {
                    assert.ok(_.findIndex(updatedHostKeys, k),
                              'host ' + k + ' does not exist in host list');
                });
                var connectingKeys = _.keys(connections.connecting);
                _.forEach(connectingKeys, function (k) {
                    assert.ok(_.findIndex(updatedHostKeys, k),
                              'host ' + k + ' does not exist in host list');
                });
                var freeKeys = _.keys(connections.free);
                _.forEach(freeKeys, function (k) {
                    assert.ok(_.findIndex(updatedHostKeys, k),
                              'host ' + k + ' does not exist in host list');
                });
                checkPool(CONNECTION_POOL);
                done();
            }, 100);
        });
    });

    it('should gracefully handle pool size larger than actual available hosts',
        function (done) {
        var poolSize = _.keys(SERVER_CFG).length + 5;
        CONNECTION_POOL = reactiveSocket.createTcpLoadBalancer({
            size: poolSize,
            log: LOG,
            hosts: SERVER_CFG
        });
        CONNECTION_POOL.on('connected', function () {
            assert.fail(null, null, 'should not get connected event');
        });

        CONNECTION_POOL.on('ready', function () {
            var connections = CONNECTION_POOL._connections;
            var connected = _.keys(connections.connected).length;
            var connecting = _.keys(connections.connecting).length;
            var free = _.keys(connections.free).length;
            assert.equal(SERVER_CFG.length, connected + connecting,
                'pool size should be size of servers');
            assert.equal(0, free, 'free list should be empty');
            done();
        });
    });

    it('#55 should maintain connections if remote connections close',
        function (done) {
        CONNECTION_POOL = reactiveSocket.createTcpLoadBalancer({
            // size has to be host list so when all connections close, there
            // are no free connections to connect to.
            size: SERVER_CFG.length,
            log: LOG,
            hosts: SERVER_CFG
        });
        CONNECTION_POOL.on('connected', function () {
            var count = 0;
            // close all connections manually
            _.forEach(CONNECTION_POOL._connections.connected, function (c) {
                c.close();
                c.on('close', function () {
                    count++;
                    // check that all these connections are still in the pool
                    if (count === SERVER_CFG.length) {
                        setTimeout(function () {
                            checkPool(CONNECTION_POOL, SERVER_CFG.length);
                            done();
                        }, 100);
                    }
                });
            });
        });
    });

    it('should resize pool to 0 and back', function (done) {
        CONNECTION_POOL = reactiveSocket.createTcpLoadBalancer({
            size: POOL_SIZE,
            log: LOG,
            hosts: []
        });

        // neither 'ready' nor 'connected' should fire when there are initially
        // no connections
        function onConnected() {
            assert.fail(null, null, 'should not get connected event');
        }
        function onReady() {
            assert.fail(null, null, 'should not get ready event');
        }

        CONNECTION_POOL.once('connected', onConnected);
        CONNECTION_POOL.once('ready', onReady);
        setTimeout(function () {
            var connections = CONNECTION_POOL._connections;
            var connected = connections.connected;
            assert.equal(0, _.keys(connected).length, 'pool size should be 0');
            var free = connections.free;
            assert.equal(0, _.keys(free).length, 'free list should be empty');
            checkPool(CONNECTION_POOL, 0);
            CONNECTION_POOL.removeListener('connected', onConnected);
            CONNECTION_POOL.removeListener('ready', onReady);
            // update with > POOL_SIZE hosts
            CONNECTION_POOL.updateHosts(SERVER_CFG);
            CONNECTION_POOL.on('connected', function () {
                checkPool(CONNECTION_POOL);
                // update with < POOL_SIZE hosts
                CONNECTION_POOL.updateHosts(_.sampleSize(SERVER_CFG,
                                                         POOL_SIZE - 1));
                setTimeout(function () {
                    checkPool(CONNECTION_POOL, POOL_SIZE - 1);
                    // update with 0 hosts
                    CONNECTION_POOL.updateHosts([]);
                    setTimeout(function () {
                        checkPool(CONNECTION_POOL, 0);
                        // update with > POOL_SIZE hosts
                        CONNECTION_POOL.updateHosts(SERVER_CFG);
                        setTimeout(function () {
                            checkPool(CONNECTION_POOL);
                            done();
                        }, 100);
                    }, 100);
                    // update with 0 hosts
                }, 100);
            });
        }, 100);
    });

    it('should get a connection and req/res', function (done) {

        CONNECTION_POOL = reactiveSocket.createTcpLoadBalancer({
            size: POOL_SIZE,
            log: LOG,
            hosts: SERVER_CFG
        });

        CONNECTION_POOL.on('connected', function () {
            var response = CONNECTION_POOL.getConnection()
                .request(_.cloneDeep(EXPECTED_REQ));
            response.on('response', function (res) {
                assert.deepEqual(res.getResponse(), EXPECTED_RES);
                done();
            });
        });
    });

    it('should get a connection and req/err', function (done) {

        CONNECTION_POOL = reactiveSocket.createTcpLoadBalancer({
            size: POOL_SIZE,
            log: LOG,
            hosts: SERVER_CFG
        });


        CONNECTION_POOL.on('connected', function () {
            var response = CONNECTION_POOL.getConnection()
                .request(_.cloneDeep(EXPECTED_ERROR_REQ));
            response.once('application-error', function (err) {
                assert.deepEqual(_.omit(err, 'header', 'metadataEncoding',
                                        'dataEncoding'),
                EXPECTED_APPLICATION_ERROR);
                done();
            });
        });
    });

    it('should get a connection, send req/res, bad connection before res',
       function (done) {
        CONNECTION_POOL = reactiveSocket.createTcpLoadBalancer({
            size: POOL_SIZE,
            log: LOG,
            hosts: SERVER_CFG
        });

        var connection;

        CONNECTION_POOL.on('connected', function () {
            connection = CONNECTION_POOL.getConnection();
            var response = connection.request(_.cloneDeep(EXPECTED_REQ));
            response.on('response', function (res) {
                throw new Error('should not get response');
            });
            response.on('error', function (err) {
                done();
            });
            connection._transportStream.end();
        });
    });

    it('should get a connection, send req/res, bad connection after res',
       function (done) {

           CONNECTION_POOL = reactiveSocket.createTcpLoadBalancer({
            size: POOL_SIZE,
            log: LOG,
            hosts: SERVER_CFG
        });

           var connection;

           CONNECTION_POOL.on('connected', function () {
               connection = CONNECTION_POOL.getConnection();
               var response = connection.request(_.cloneDeep(EXPECTED_REQ));
               response.on('response', function (res) {
                   assert.deepEqual(res.getResponse(), EXPECTED_RES);
                   connection._transportStream.end();
                   setImmediate(done);
               });
               response.on('error', function (err) {
                throw new Error('should not get err');
            });
           });
       });

    it('should return a null connection when there are no connected hosts',
       function (done) {
        CONNECTION_POOL = reactiveSocket.createTcpLoadBalancer({
           size: POOL_SIZE,
           log: LOG,
           hosts: [] // empty array so no hosts to connect to
       });

        assert.notOk(CONNECTION_POOL.getConnection());
        done();
    });
});


/// Privates


function checkPool(pool, poolSize) {
    var connections = pool._connections;
    var hosts = pool._hosts;

    if (typeof (poolSize) !== 'number') {
        poolSize = POOL_SIZE;
    }
    var connected = _.keys(connections.connected);
    var connecting = _.keys(connections.connecting);
    var free = _.keys(connections.free);
    LOG.debug('pool size', poolSize);
    LOG.debug('free', free.sort());
    LOG.debug('connected', connected.sort());
    LOG.debug('connecting', connecting);
    var connFreeIntersection = _.intersection(connected, connecting, free)
        .sort();
    LOG.debug('connFreeIntersection', connFreeIntersection);

    assert.equal(poolSize, connected.length,
                 'should have the right amount of connected connections');
    assert.equal(hosts.length, free.length + connected.length +
                 connecting.length, 'hosts and connections count should match');
    assert.equal(connecting.length, 0,
                 'should not have conns in connecting state');
    assert.equal(connFreeIntersection.length, 0, 'should not have conns in' +
                 'free, connected, and connecting state');
}
