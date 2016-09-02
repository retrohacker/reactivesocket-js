'use strict';

var ReactiveSocket = require('./connection/reactivesocket');
var TcpConnection = require('./connection/tcpConnection');
var TcpLoadBalancer = require('./connection/tcpLoadBalancer');

module.exports = {
    TYPES: require('./protocol/constants').TYPES,
    FLAGS: require('./protocol/constants').FLAGS,
    ERROR_CODES: require('./protocol/constants').ERROR_CODES,
    VERSION: require('./protocol/constants').VERSION,
    createReactiveSocket: function (opts) {
        return new ReactiveSocket(opts);
    },
    createTcpConnection: function (opts) {
        return new TcpConnection(opts);
    },
    createTcpLoadBalancer: function (opts) {
        return new TcpLoadBalancer(opts);
    }
};
