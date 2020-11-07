const StateReceiver = require('@eosdacio/eosio-statereceiver');
const {Api, JsonRpc, Serialize} = require('eosjs');
const Int64 = require('int64-buffer').Int64BE;
const fetch = require('node-fetch');
const { ExplorerApi } = require('atomicassets');

const telegram_api_key = require('./secret').telegram_api_key;
const telegram_channel = 'packrips';
// const telegram_channel = 'gqjfgtyu';
const telegram_bot = 'packrips_bot';

const unbox_contracts = ['unbox.nft'];

const ipfs_prefix = 'https://ipfs.io/ipfs/';
const atomicassets_account = 'atomicassets';
const atomic_endpoint = 'https://wax.api.atomicassets.io';
const endpoint = 'https://wax.eosdac.io';
const atomic = new ExplorerApi(atomic_endpoint, atomicassets_account, { fetch, rateLimit: 4 });
const eos_rpc = new JsonRpc(endpoint, {fetch});
const eos_api = new Api({ rpc: eos_rpc, signatureProvider:null, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });



class TraceHandler {
    constructor({config}) {
        this.config = config;
    }

    async sendMessage(msg, channel){
        // console.log('Sending telegram message', msg);
        const url = `https://api.telegram.org/bot${telegram_api_key}/sendMessage`;
        const msg_obj = {
            chat_id: `@${channel}`,
            text: msg, //.replace(/\(/g, '\\(').replace(/\)/g, '\\)'),
            parse_mode: 'MarkdownV2'
        }
        // console.log(JSON.stringify(msg_obj));

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(msg_obj)
        });
        const resp_json = await res.json()
        console.log(resp_json, JSON.stringify(msg_obj));
        if (!resp_json.ok && resp_json.error_code === 429 && resp_json.parameters.retry_after){
            console.log(`Flooding, try again after ${resp_json.parameters.retry_after}s`)
            setTimeout(() => {
                this.sendMessage(msg, channel);
            }, (resp_json.parameters.retry_after + 1) * 1000);
        }

        return resp_json
    }

    normaliseTemplateData(td){
        const data = {};
        td.forEach(d => {
            const val_raw = d.value[1];
            if (d.value[0].substr(0, 4) == 'uint'){
                data[d.key] = parseInt(d.value[1]);
            }
            else {
                data[d.key] = d.value[1];
            }
        });
        return data;
    }

    getString(minted){
        let str = '';
        const items = [];
        minted.forEach(m => {
            const card_data = this.normaliseTemplateData(m.immutable_template_data);
            const market_url = 'https://wax.atomichub.io';
            const market_link = `[${m.asset_id}](${market_url}/explorer/asset/${m.asset_id})`;
            let desc = '';

            const emoji = {};

            if (typeof emoji[card_data.rarity] !== 'undefined'){
                desc += `${emoji[card_data.rarity]} `;
            }
            desc += card_data.name + ' ';
            if (card_data.rarity){
                desc += card_data.rarity + ' ';
            }

            items.push(`${desc}- ${market_link}`);
        });
        str += items.join(`\n`);

        str += `\n`;

        return str;
    }

    escapeTelegram(str){
        return str.replace(/\!/g, '\\!').replace(/\./g, '\\.').replace(/\-/g, '\\-').replace(/\#/g, '\\#').replace(/\*/g, '\\*').replace(/\_/g, '\\_');
    }

    async processMessage(minted, pack_data){
        const opener = minted[0].new_asset_owner;
        // console.log(pack_data);

        const pack_name_str = this.escapeTelegram(`[${pack_data.name}](${ipfs_prefix}${pack_data.data.img})`);
        let str = `${this.escapeTelegram(opener)} opened a ${pack_name_str} pack containing:\n\n`;
        str += this.escapeTelegram(this.getString(minted));

        // console.log(str);

        this.sendMessage(str, telegram_channel);
    }

    async queueTrace(block_num, traces, block_timestamp) {
        let is_unbox, minted, pack_data;

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
                                if (unbox_contracts.includes(action[1].act.account) && action[1].act.name == 'claim'){
                                    const action_deser = await eos_api.deserializeActions([action[1].act]);
                                    pack_data = await atomic.getAsset(action_deser[0].data.assoc_id);
                                    is_unbox = true;
                                }
                                else if (is_unbox && action[1].act.account === 'atomicassets' && action[1].act.name == 'logmint' && action[1].receiver == 'atomicassets'){
                                    const action_deser = await eos_api.deserializeActions([action[1].act]);
                                    minted.push(action_deser[0].data);
                                }
                                break;
                        }
                    }

                    if (is_unbox){
                        console.log(`is unbox ${pack_data.name}`, minted.length, minted);
                        this.processMessage(minted, pack_data);
                        // process.exit(0)
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

    const trace_handler = new TraceHandler({config});

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
