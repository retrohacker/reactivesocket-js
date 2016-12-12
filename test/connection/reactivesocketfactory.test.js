'use strict';

var startEchoServer = require('../common/startEchoServer');
var ReactiveSocketFactory = require('../../lib/connection/reactivesocketfactory');

describe('ReactiveSocketFactory', function () {
    it('Create a factory from ip:port', function (done) {
        this.timeout(30 * 1000);

        var port = 8080;
        var server = startEchoServer({port: 8080, host: 'localhost'});
        var factory = new ReactiveSocketFactory({
            port: port,
            host: 'localhost'
        });

        factory.apply().on('reactivesocket', function (rs) {
            rs.request({data: 'Hey'}).on('response', function (res) {
                server.close();
                done();
            });
        });
    });
});