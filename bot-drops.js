#!/usr/bin/env node

const StateReceiver = require('@eosdacio/eosio-statereceiver');
const {Api, JsonRpc, Serialize} = require('eosjs');
const Int64 = require('int64-buffer').Int64BE;
const fetch = require('node-fetch');
const { ExplorerApi } = require('atomicassets');
const { deserialize, ObjectSchema } = require("atomicassets");
const fs = require('fs');
const FormData = require('form-data');
const FileType = require('file-type');
const md5 = require('md5');
const bs58 = require('bs58');
const crypto = require('crypto');
const { fork } = require('child_process');

const telegram_api_key = require('./secret').telegram_api_key;
const telegram_channel = 'allnftdrops';
// const telegram_channel = 'gqjfgtyu';
const telegram_bot = 'packrips_bot';

const atomicassets_account = 'atomicassets';
const atomicdrops_contract = 'atomicdropsx';
const endpoint = 'http://127.0.0.1:28888';
const atomic_endpoint = 'https://wax.api.atomicassets.io';
const eos_rpc = new JsonRpc(endpoint, {fetch});
const eos_api = new Api({ rpc: eos_rpc, signatureProvider:null, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
// const atomic = new ExplorerApi(atomic_endpoint, atomicassets_account, { fetch, rateLimit: 4 });


class TraceHandler {
    constructor({config, msg_handler}) {
        this.config = config;
        this.msg_handler = msg_handler;
    }

    async queueTrace(block_num, traces, block_timestamp) {
        let is_unbox, minted, pack_data, unboxing_id;

        for (const trace of traces) {
            switch (trace[0]) {
                case 'transaction_trace_v0':
                    const trx = trace[1];
                    is_unbox = false;
                    minted = [];
                    pack_data = null
                    // console.log(trx)
                    for (let action of trx.action_traces) {
                        //console.log(action)
                        switch (action[0]) {
                            case 'action_trace_v0':
                                if (action[1].act.account === atomicdrops_contract && action[1].act.name == 'lognewdrop'){
                                    const action_deser = await eos_api.deserializeActions([action[1].act]);
                                    // console.log(action_deser[0].data);
                                    this.msg_handler.send(JSON.stringify(action_deser[0].data));
                                    // this.processMessage(action_deser[0].data);
                                }
                                break;
                        }
                    }

                    break;
            }
        }
    }

    async processTrace(block_num, traces, block_timestamp) {
        // console.log(`Process block ${block_num}`)
        return this.queueTrace(block_num, traces, block_timestamp);
    }

}

const start = async (start_block) => {

    const config = require('./config');

    config.telegram_api_key = telegram_api_key;
    config.telegram_channel = telegram_channel;
    config.telegram_bot = telegram_bot;

    const msg_handler = fork('./msg-handler', [JSON.stringify(config)]);

    const trace_handler = new TraceHandler({config, msg_handler});

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
