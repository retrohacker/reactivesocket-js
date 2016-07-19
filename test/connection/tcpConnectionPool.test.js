'use strict';

var net = require('net');

var _ = require('lodash');
var assert = require('chai').assert;
var bunyan = require('bunyan');

var reactiveSocket = require('../../lib');

var ERROR_CODES = reactiveSocket.ERROR_CODES;

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
        CONNECTION_POOL = reactiveSocket.createTcpConnectionPool({
            size: POOL_SIZE,
            log: LOG,
            hosts: SERVER_CFG
        });

        var isReady;
        CONNECTION_POOL.on('ready', function () {
            isReady = true;
        });
        CONNECTION_POOL.on('connected', function () {
            assert.equal(POOL_SIZE,
                         _.keys(CONNECTION_POOL._connections.connected).length);
            assert.ok(isReady, 'ready event did not fire');
            return done();
        });
    });

    it('should tolerate connection failure', function (done) {
        CONNECTION_POOL = reactiveSocket.createTcpConnectionPool({
            size: POOL_SIZE,
            log: LOG,
            hosts: SERVER_CFG
        });

        CONNECTION_POOL.on('connected', function () {
            CONNECTION_POOL.on('connect', function () {
                done();
            });
            CONNECTION_POOL.getConnection()._transportStream.end();
        });
    });

    it('should tolerate multiple connection failures', function (done) {
        CONNECTION_POOL = reactiveSocket.createTcpConnectionPool({
            size: POOL_SIZE,
            log: LOG,
            hosts: SERVER_CFG
        });

        CONNECTION_POOL.on('connected', function () {
            var reconnectCount = 0;
            CONNECTION_POOL.on('connect', function () {
                reconnectCount++;

                if (reconnectCount === POOL_SIZE) {
                    done();
                }
            });
            _.forEach(CONNECTION_POOL._connections.connected, function (c) {
                c._tcpConn.end();
            });
        });
    });

    it('should update hosts', function (done) {
        CONNECTION_POOL = reactiveSocket.createTcpConnectionPool({
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
            // Lame way to wait for new connections to be made
            setImmediate(function () {
                assert.ok(connected[connection], 'live connection that spans' +
                    'previous and current hosts should still be connected');
                // verify that pool only contains connections from the updated
                // list
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
                done();
            });
        });
    });

    it('should handle pool size larger than actual available hosts',
       function (done) {

    });

    it('should get a connection and req/res', function (done) {

        CONNECTION_POOL = reactiveSocket.createTcpConnectionPool({
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

        CONNECTION_POOL = reactiveSocket.createTcpConnectionPool({
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
           this.timeout(123123123);

           CONNECTION_POOL = reactiveSocket.createTcpConnectionPool({
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

    it('should get a connection, send req/res, bad connection after res ',
       function (done) {

           CONNECTION_POOL = reactiveSocket.createTcpConnectionPool({
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
});
