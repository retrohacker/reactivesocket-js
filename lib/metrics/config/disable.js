'use strict';

var NullCounter = require('./counter/null.js');
var NullTimer = require('./timer/null.js');

/**
 * Disable configuration.
 * Discard all events.
 */
var config = {
    recorder: {
        timer: function (recorder, name, tags) {
            return NullTimer();
        },
        counter: function (recorder, name, value, tags) {
            return NullCounter();
        }
    },
    aggregator: {
        timer: {
            factory: function (name) {
                return null; // never used
            }
        },
        composites: null
    }
};

module.exports = config;
