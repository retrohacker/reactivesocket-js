'use strict';

var bunyan = require('bunyan');

var LOG = bunyan.createLogger({
    name: 'reactive socket tests',
    level: process.env.LOG_LEVEL || bunyan.ERROR,
    serializers: bunyan.stdSerializers,
    stream: process.stderr
});

LOG.addSerializers({
    buffer: function (buf) {
        return buf.toString();
    }
});

module.exports = LOG;
