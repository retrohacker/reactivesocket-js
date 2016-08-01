'use strict';

var Connection = require('./connection/connection');
var TcpConnection = require('./connection/tcpConnection');
var TcpLoadBalancer = require('./connection/tcpLoadBalancer');

module.exports = {
    TYPES: require('./protocol/constants').TYPES,
    FLAGS: require('./protocol/constants').FLAGS,
    ERROR_CODES: require('./protocol/constants').ERROR_CODES,
    VERSION: require('./protocol/constants').VERSION,
    createConnection: function (opts) {
        return new Connection(opts);
    },
    createTcpConnection: function (opts) {
        return new TcpConnection(opts);
    },
    createTcpLoadBalancer: function (opts) {
        return new TcpLoadBalancer(opts);
    }
};

