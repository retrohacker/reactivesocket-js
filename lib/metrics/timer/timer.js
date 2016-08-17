'use strict';

var assert = require('assert-plus');

/**
 * Factory of the default timer.
 *
 * @param {Object} recorder Recorder the aggregator listen to.
 * @param {String} name Name of the timer.
 * @param {Object} tags optional tags associated with the timer.
 * @returns {Object} Timer object
 */
module.exports = function makeTimer(recorder, name, tags) {
    assert.object(recorder, 'recorder');
    assert.string(name, 'name');
    assert.optionalObject(tags);

    var timerEvent = {
        name: name
    };

    if (tags) {
        timerEvent.tags = tags;
    }
    return {
        start: function () {
            return Date.now();
        },
        stop: function (id) {
            timerEvent.startTs = id;
            timerEvent.stopTs = Date.now();
            recorder.emit('timer', timerEvent);
        }
    };
};
