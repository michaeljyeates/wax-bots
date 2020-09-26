const fs = require('fs');
const StateReceiver = require('@eosdacio/eosio-statereceiver');
const {Api, JsonRpc, Serialize} = require('eosjs');
const Int64 = require('int64-buffer').Int64BE;
const fetch = require('node-fetch');
const { RpcApi, ExplorerApi } = require("atomicassets");
const { TextDecoder, TextEncoder } = require('text-encoding');

const endpoint = 'https://wax.eosdac.io';
const atomic_endpoint = 'https://wax.api.atomicassets.io';
const aa_api = new ExplorerApi(atomic_endpoint, 'atomicassets', {fetch, rateLimit: 4});
const eos_rpc = new JsonRpc(endpoint, {fetch});
const eos_api = new Api({ rpc: eos_rpc, signatureProvider:null, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });


const opens = [];
let queue = [];
const csv_filename = 'pack_opens.csv';
let finished = false;

class TraceHandler {
    constructor({config, end_block}) {
        this.config = config;
        this.end_block = end_block;
    }

    async queueTrace(block_num, traces, block_timestamp) {

        for (const trace of traces) {
            switch (trace[0]) {
                case 'transaction_trace_v0':
                    const trx = trace[1];
                    // console.log(trx)
                    for (let action of trx.action_traces) {
                        //console.log(action)
                        switch (action[0]) {
                            case 'action_trace_v0':
                                if (action[1].act.account === 'atomicassets' && action[1].act.name === 'transfer' && action[1].receiver === 'unbox.heroes'){
                                    const act = await eos_api.deserializeActions([action[1].act]);
                                    if (act[0].data.to === 'unbox.heroes'){
                                        // find total assets sent to this address
                                        /* const url = `https://wax.api.atomicassets.io/atomicassets/v1/accounts/unbox.heroes`;
                                        const res = await fetch(url);
                                        const res_json = await res.json();

                                        setTimeout(() => {
                                            res_json.data.collections.forEach(c => {
                                                if (c.collection.collection_name === 'officialhero'){
                                                    if (c.assets == 9500){
                                                        console.log(`9500-th pack opened at block ${block_num}, tx id ${trx.id}`);
                                                    }
                                                    else {
                                                        console.log(`${block_num} contains ${c.assets}-th pack opening`);
                                                    }
                                                }
                                            });
                                        }, 5000);


                                        return; */

                                        // console.log('action data', act);
                                        // const asset = await aa_api.getAsset(act[0].data.asset_ids[0]);
                                        // console.log(asset);

                                        // console.log(`Pushing`);
                                        queue.push({
                                            opener: act[0].data.from,
                                            asset_id: act[0].data.asset_ids[0]
                                        });

                                        if (queue.length === 125){
                                            finished = true;
                                        }
                                        // opens.push({
                                        //     opener: act[0].data.from,
                                        //     pack: asset.template.immutable_data.name,
                                        //     mint: asset.template_mint
                                        // });
                                    }
                                    continue;
                                }
                                break;
                        }
                    }
                    break;
            }
        }

        if (this.end_block === block_num){
            setTimeout(() => {
                finished = true;
            }, 10000);
        }
    }

    async processTrace(block_num, traces, block_timestamp) {
        // console.log(`Process block ${block_num}`)
        return this.queueTrace(block_num, traces, block_timestamp);
    }

}

const sleep = async (ms) => {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
};

const start = async (start_block, end_block) => {

    const config = require('./config');

    const trace_handler = new TraceHandler({config, end_block});

    sr = new StateReceiver({
        startBlock: start_block,
        endBlock: 0xffffffff,
        mode: 0,
        config
    });
    sr.registerTraceHandler(trace_handler);
    sr.start();

    setInterval(process_queue, 500);
}

const process_queue = async () => {
    const tmp_queue = queue;
    queue = [];
    if (tmp_queue.length){
        // console.log(tmp_queue);
        const ids = tmp_queue.map(t => t.asset_id);
        // console.log(ids);
        const url = `${atomic_endpoint}/atomicassets/v1/assets?ids=${ids.join(',')}`;
        // console.log(url);
        const res = await fetch(url);
        const j_res = await res.json();
        // console.log(j_res);
        const assets = j_res.data;
        // console.log(assets);
        tmp_queue.forEach(t => {
            const asset = assets.find(a => a.asset_id === t.asset_id);
            // console.log(t, asset);
            const open_data = {
                opener: t.opener,
                asset_id: t.asset_id,
                mint: asset.template_mint,
                name: asset.name
            };
            console.log(open_data);
            opens.push(open_data);
        });
    }

    if (finished){
        export_csv(opens);
        process.exit(0);
    }
}

const export_csv = (opens) => {
    const opens_csv = opens.map(o => {
        return `${o.opener},${o.name},${o.mint},${o.asset_id}`
    });

    console.log(opens_csv);

    fs.writeFileSync(csv_filename, opens_csv.join(`\n`));
}

const run = async () => {
    let start_block;
    const info = await eos_rpc.get_info();

    if (typeof process.argv[2] !== 'undefined'){
        start_block = parseInt(process.argv[2]);
        if (isNaN(start_block)){
            console.error(`Start block must be a number`);
            process.exit(1);
        }
    }
    else {
        start_block = info.head_block_num;
    }

    start(start_block, info.head_block_num);
    // start(start_block, start_block + 2000);
}

run();
