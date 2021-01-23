const StateReceiver = require('@eosdacio/eosio-statereceiver');
const {Api, JsonRpc, Serialize} = require('eosjs');
const Int64 = require('int64-buffer').Int64BE;
const fetch = require('node-fetch');
const fs = require('fs');
const { RpcApi } = require("atomicassets");
const { TextDecoder, TextEncoder } = require('text-encoding');
const WebSocketServer = require('websocket').server;
const http = require('http');
const path = require('path');

const endpoint = 'https://wax.eosdac.io';
const atomic_endpoint = 'https://wax.api.atomicassets.io';
const aa_api = new RpcApi(endpoint, 'atomicassets', {fetch, rateLimit: 4});
const eos_rpc = new JsonRpc(endpoint, {fetch});
const eos_api = new Api({ rpc: eos_rpc, signatureProvider:null, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });

const port = 3030;
const host = '0.0.0.0';

const { TraceHandler } = require(`./atomic-sales-tracehandler`);

class WSClient {
    constructor({connection, collection}) {
        this.connection = connection;
        this.collection = collection;
    }
}

class WSSender {

    constructor({config}) {
        this.config = config;
        this.start_websocket();
        this.clients = {};
    }

    add_client(client){
        if (typeof this.clients[client.collection] === 'undefined'){
            this.clients[client.collection] = [];
        }

        this.clients[client.collection].push(client);
    }

    start_websocket() {

        var server = http.createServer(function(request, response) {
            console.log((new Date()) + ' Received request for ' + request.url);

            if (request.url.substr(0, 4) === '/js/'){
                const js = request.url.substr(4);
                const p = path.normalize('./js/' + js);
                sendJs(response, p);
            }
            else {
                sendIndex(response);
            }
        });

        const sendJs = (response, file) => {
            if (!fs.existsSync(file)){
                response.writeHead(404);
                response.end();
                return;
            }

            response.writeHead(200, {
                "Content-Type": "application/javascript"
            });
            fs.createReadStream('./' + file).pipe(response);
        };

        const sendIndex = (response) => {
            response.writeHead(200, {
                "Content-Type": "text/html"
            });
            fs.createReadStream("./ws-index.html").pipe(response);
        };


        server.listen(port, host, () => {
            console.log((new Date()) + ' Server is listening on port 8080');
        });

        const wsServer = new WebSocketServer({
            httpServer: server,
            // You should not use autoAcceptConnections for production
            // applications, as it defeats all standard cross-origin protection
            // facilities built into the protocol and the browser.  You should
            // *always* verify the connection's origin and decide whether or not
            // to accept it.
            autoAcceptConnections: false
        });

        function originIsAllowed(origin) {
            // put logic here to detect whether the specified origin is allowed.
            return true;
        }

        wsServer.on('request', (request) => {
            if (!originIsAllowed(request.origin)) {
                // Make sure we only accept requests from an allowed origin
                request.reject();
                console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
                return;
            }

            var connection = request.accept('echo-protocol', request.origin);
            console.log((new Date()) + ` Connection accepted from origin ${request.origin}.`);
            connection.on('message', (message) => {
                if (message.type === 'utf8') {
                    console.log('Received Message: ' + message.utf8Data);
                    // connection.sendUTF(message.utf8Data);

                    try {
                        const json = JSON.parse(message.utf8Data);

                        if (json.type === 'register'){
                            const client = new WSClient({connection, collection: json.data.collection});

                            this.add_client(client);
                        }
                        else {
                            connection.sendUTF(JSON.stringify({type:'error', msg: `Unknown message type "${json.type}"`}));
                        }
                    }
                    catch (e){
                        connection.sendUTF(JSON.stringify({type:'error', msg: e.message}));
                        console.error(e);
                    }
                }
            });
            connection.on('close', function(reasonCode, description) {
                console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.');
            });
        });
    }

    async send_sale(client, buyer, seller, quantity, asset) {
        // console.log(client);
        console.log(`Sending message ${JSON.stringify({buyer, seller, quantity, asset: asset.data})}`)
        client.connection.sendUTF(JSON.stringify({type:'sale', data:{buyer, seller, quantity, asset}}));
    }

    async sale (protocol, buyer, seller, quantity, asset, block_num, block_timestamp) {
        console.log('SALE! Sending to ws', buyer, seller, quantity, asset);

        if (!asset.collection){
            console.log(`Could not find collection`);
            return;
        }

        const collection = asset.collection.collection_name;
        console.log(`Sale has collection ${collection}`);
        if (typeof this.clients[collection] !== 'undefined'){
            console.log(`Sending to ${this.clients[collection].length} specific clients`);
            this.clients[collection].forEach((c) => {this.send_sale(c, buyer, seller, quantity, asset)});
        }
        if (typeof this.clients['*'] !== 'undefined'){
            console.log(`Sending to ${this.clients['*'].length} general clients`);
            this.clients['*'].forEach((c) => {this.send_sale(c, buyer, seller, quantity, asset)});
        }
    }
}


const start = async (start_block) => {

    const config = require('./config');
    config.atomic_endpoint = atomic_endpoint;

    const trace_handler = new TraceHandler({config});

    const ws = new WSSender({config});
    trace_handler.add_sale_notify(ws);

    sr = new StateReceiver({
        startBlock: start_block,
        endBlock: 0xffffffff,
        mode: 0,
        config
    });
    sr.registerTraceHandler(trace_handler);
    sr.start();
}


const run = async () => {
    let start_block;
    if (typeof process.argv[2] !== 'undefined'){
        start_block = parseInt(process.argv[2]);
        if (isNaN(start_block)){
            console.error(`Start block must be a number`);
            process.exit(1);
        }
    }
    else {
        const info = await eos_rpc.get_info();
        start_block = info.head_block_num;
    }

    start(start_block);
}

run();
