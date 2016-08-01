
[![NPM Version](https://img.shields.io/npm/v/reactivesocket.svg)](https://npmjs.org/package/reactivesocket)
[![Build Status](https://travis-ci.org/ReactiveSocket/reactivesocket-js.svg?branch=master)](https://travis-ci.org/ReactiveSocket/reactivesocket-js)
[![Coverage Status](https://coveralls.io/repos/github/ReactiveSocket/reactivesocket-js/badge.svg?branch=master)](https://coveralls.io/github/ReactiveSocket/reactivesocket-js?branch=master)

# reactivesocket-js
ReactiveSocket Protocol for Client/Server for JS. Also comes with a [CLI](#CLI).
```bash
npm install -g reactivesocket
```
This library only supports the `request/response`, `setup` and `error`
interactions. More interactions are coming soon.

## Streams
The transport for this library is built entirely on top of the Node.js
[Stream](https://nodejs.org/api/stream.html) API.  As a result, it is agnostic
to the underlying transport mechanism. As long as you pass in a transport
stream that is a Node.js
[Duplex](https://nodejs.org/api/stream.html#stream_class_stream_duplex) stream,
this library will work.

Using streams means that this library natively supports backpressure regardless
of the transport implementation.

We currently target TCP via the [net](https://nodejs.org/api/net.html) module,
and WebSockets via the [yws-stream](https://github.com/yunong/ws-stream)
module. You are of course, free to inject other transports.

## Connection Quick Start
This library supports 3 classes of clients. A fully managed load balancer,
which automatically manages a pool of connections and takes care of
automatically reconnecting and load-balancing connections from the pool. A fully
managed single TCP connection, which can be configured to automatically
reconnect if the TCP connection disconnects. Lastly a "raw" ReactiveSocket
connection, which doesn't include any retry or transport logic. You provide a
transport stream to plug in to the connection. This is the most flexible
client, as you can use it with any transport mechanism. Examples for TCP and
WebSockets are provided.

### TCP Client Side Load Balancer
```javascript
var bunyan = require('bunyan');
var reactiveSocket = require('reactivesocket');

var connectionPool = reactiveSocket.createTcpLoadBalancer({
    size: 5, // size of the pool, defaults to 5
    log: bunyan.createLogger({name: 'rsLoadBalancer'}),
    hosts: [{ // array of host:port objects to connect to
        host: 'localhost',
        port: 1337
    },{
        host: 'localhost',
        port: 1338
    },{
        host: 'localhost',
        port: 1339
    },{
        host: 'localhost',
        port: 1340
    },{
        host: 'localhost',
        port: 1341
    },{
        host: 'localhost',
        port: 1342
    },{
        host: 'localhost',
        port: 1343
    }]
});

connectionPool.on('ready', function () {
    var stream = connectionPool.getConnection().request({
        metadata: 'You reached for the secret too soon, you cried for the moon',
        data: 'Shine on you crazy diamond.'
    });

    stream.on('response', function (res) {
        console.log('got response', res.getResponse());
    });

    stream.on('application-error', function (err) {
        console.error('got error', err);
    });

    stream.on('error', function (err) {
        console.error('got rs connection error', err);
    });
});

```

### TCP Connection
```javascript
var bunyan = require('bunyan');
var reactiveSocket = require('reactivesocket');

var tcpConnection = reactiveSocket.createTcpConnection({
    log: bunyan.createLogger({name: 'rsConnection'}),
    connOpts: { // host to connect to
        host: 'localhost',
        port: 1337
    },
    reconnect: true // whether to reconnect if the TCP connection dies
});

tcpConnection.on('ready', function () {
    var stream = tcpConnection.getConnection().request({
        metadata: 'You reached for the secret too soon, you cried for the moon',
        data: 'Shine on you crazy diamond.'
    });

    stream.on('response', function (res) {
        console.log('got response', res.getResponse());
    });

    stream.on('application-error', function (err) {
        console.error('got error', err);
    });

    stream.on('error', function (err) {
        console.error('got rs connection error', err);
    });
});
```

### Raw TCP
```javascript
var net = require('net');

var bunyan = require('bunyan');
var reactiveSocket = require('reactivesocket');


// Create any transport stream that's a Node.js Duplex Stream.
var transportStream = net.connect(1337, 'localhost', function (err) {
    var rsConnection = reactiveSocket.createConnection({
        log: bunyan.createLogger({name: 'rsConnection'}),
        transport: {
            stream: transportStream,
            framed: true // TCP requires explicit framing
        },
        type: 'client',
        metadataEncoding: 'utf8',
        dataEncoding: 'utf8'
    });

    rsConnection.on('ready', function () {
        // returns a reactive socket stream
        var stream = rsConnection.request({
            metadata: 'You reached for the secret too soon, you cried for the moon',
            data: 'Shine on you crazy diamond.'
        });

        stream.on('response', function (res) {
            console.log('got response', res.getResponse());
        });

        stream.on('application-error', function (err) {
            console.error('got error', err);
        });
    });
});
```
### Raw WebSocket
```javascript
var bunyan = require('bunyan');
var reactiveSocket = require('reactivesocket');

var Ws = require('ws');
var WSStream = require('yws-stream');


var websocket = new Ws('ws://localhost:1337');

// Create any transport stream that's a Node.js Duplex Stream
var transportStream = new WSStream({
    log: bunyan.createLogger({name: 'ws-stream'}),
    ws: websocket
});

// Wait for Websocket to establish connection, before we create an RS Connection
websocket.on('open', function() {

    var rsConnection = reactiveSocket.createConnection({
        log: bunyan.createLogger({name: 'rsConnection'}),
        transport: {
            stream: transportStream
        },
        type: 'client',
        metadataEncoding: 'utf8',
        dataEncoding: 'utf8'
    });

    rsConnection.on('ready', function () {
        // returns a reactive socket stream
        var stream = rsConnection.request({
            metadata: 'You reached for the secret too soon, you cried for the moon',
            data: 'Shine on you crazy diamond.'
        });

        stream.on('response', function (res) {
            console.log('got response', res.getResponse());
        });

        stream.on('application-error', function (err) {
            console.error('got error', err);
        });
    });
});
```

## Lease Semantic

ReactiveSocket client allows you to specify if you want to honor the lease
semantic.

```javascript
reactiveSocket.createConnection({
    ...,
    lease: true,
    ...
});
```

If you don't, it means that the `ReactiveSocket` is ready as
soon as the connection is established, and you can start sending messages.
But if you do, it means the client has to wait for a `LEASE` frame from the
server before sending messages.

Note that nothing is preventing the client to send requests to the server before
receiving the `LEASE`, the `LEASE` reception only update the return value of
the `availability` method (number between 0 and 1.0).

The `availability` method gives precious information to a potential higher
level library (e.g. load-balancing library) about the capability of the
underlying connection.

More details about the lease semantic are available in the
[protocol Spec](https://github.com/ReactiveSocket/reactivesocket/blob/master/Protocol.md#connection-establishment).

## CLI
This library comes with a CLI. You can use it by installing this module.
```bash
$ npm install -g reactivesocket
```

### RS Client
There are two versions of the client CLI. The simple CLI makes one request to a
server.
```bash
$ rs -o req tcp://localhost:1337 'if you didnt care what happened to me, And I didnt care for you'
```

There is also a benchmarking CLI in the vein of [Apache
Bench](https://httpd.apache.org/docs/2.4/programs/ab.html)
```bash
$ rb -c 10 -n 10000000 -s 1000 tcp://localhost:1337
{ 'elapsed time (s)': 10.529176232,
  'total reqs': 137133,
  RPS: 13024.095805636622,
  'median (ms)': 0.649035,
  'mean (ms)': 0.75758988656268,
  '0.1% (ms)': 0.457949,
  '1% (ms)': 0.498248,
  '5% (ms)': 0.544133,
  '10% (ms)': 0.565295,
  '20% (ms)': 0.596515,
  '30% (ms)': 0.616699,
  '40% (ms)': 0.633112,
  '50% (ms)': 0.649035,
  '60% (ms)': 0.671943,
  '70% (ms)': 0.708819,
  '80% (ms)': 0.772095,
  '90% (ms)': 0.905283,
  '99% (ms)': 4.441137,
  '99.9% (ms)': 6.004325,
  '99.99% (ms)': 32.613085,
  '99.999% (ms)': 101.189893 }
```

### Echo Servers
Simple echo servers are also available for both TCP and Websocket.

#### TCP
```bash
$ HOST=localhost PORT=1337 rs-tcp-server
```
#### WebSocket
```bash
$ HOST=localhost PORT=1337 rs-ws-server
```

## Contributions
Contributions welcome, please ensure `make check` runs clean.

## License
MIT

Copyright 2016 Yunong J Xiao
