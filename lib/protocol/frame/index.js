'use strict';

module.exports = {
    // Those functions generate a frame buffer from an object
    getSetupFrame: require('./getSetupFrame'),
    getLeaseFrame: require('./getLeaseFrame'),
    getKeepaliveFrame: require('./getKeepaliveFrame'),
    getReqResFrame: require('./getReqResFrame'),
    getResponseFrame: require('./getResponseFrame'),
    getErrorFrame: require('./getErrorFrame'),
    getCancelFrame: require('./getCancelFrame'),

    // This function generates an object from a network frame
    parseFrame: require('./parseFrame')
};
