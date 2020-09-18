const StateReceiver = require('@eosdacio/eosio-statereceiver');
const {Api, JsonRpc, Serialize} = require('eosjs');
const Int64 = require('int64-buffer').Int64BE;
const fetch = require('node-fetch');
const { ExplorerApi } = require('atomicassets');

const telegram_api_key = require('./secret').telegram_api_key;
const telegram_channel = 'packrips';
// const telegram_channel = 'gqjfgtyu';
const telegram_bot = 'packrips_bot';

const atomicassets_account = 'atomicassets';
const endpoint = 'https://wax.eosdac.io';
const atomic_endpoint = 'https://wax.api.atomicassets.io';
const atomic = new ExplorerApi(atomic_endpoint, atomicassets_account, { fetch, rateLimit: 4 });
const eos_rpc = new JsonRpc(endpoint, {fetch});
const eos_api = new Api({ rpc: eos_rpc, signatureProvider:null, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });


const market_lookup = {
    kogsofficial: 'https://kogs.market',
    'gpk.topps': 'https://gpk.market'
};

class TraceHandler {
    constructor({config}) {
        this.config = config;
    }

    async sendMessage(msg, photo, channel){
        // console.log('Sending telegram message', msg);
        const url = `https://api.telegram.org/bot${telegram_api_key}/sendPhoto`;
        const msg_obj = {
            chat_id: `@${channel}`,
            caption: msg,
            photo,
            parse_mode: 'Markdown'
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
        // console.log(resp_json);
        return resp_json
    }

    normaliseAttributes(attrs){
        const normalised = {};
        attrs.forEach(a => {
            normalised[a.key] = a.value[1];
        });
        return normalised;
    }

    getString(minted){
        let str = '';
        const items = [];
        minted.forEach(m => {
            const card_data = this.normaliseAttributes(m.immutable_template_data);
            let market_url = market_lookup[m.collection_name];
            if (!market_url){
                market_url = 'https://myth.market';
            }
            const market_link = `[${m.asset_id}](${market_url}/asset/${m.asset_id}?referral=mryeateshere)`;
            let desc = '';
            if (card_data.rarity){
                desc += `${card_data.rarity.charAt(0).toUpperCase()}${card_data.rarity.slice(1)} `;
            }
            if (card_data.cardid && card_data.quality){
                desc += `${card_data.cardid}${card_data.quality} `;
            }
            desc += card_data.name + ' ';
            if (card_data.variant){
                desc += card_data.variant + ' ';
            }
            if (card_data.foil){
                desc += 'FOIL ';
            }
            if (card_data.object){
                desc += card_data.object + ' ';
            }
            if (card_data.border_color){
                desc += `\(${card_data.border_color} border\) `;
            }

            items.push(`${desc}- ${market_link}`);
        });
        str += items.join(`\n`);

        str += `\n`;

        return str;
    }

    async processMessage(pack_data, minted){
        const opener = minted[0].new_asset_owner;
        console.log(pack_data);

        let pack_name = pack_data.name;
        // if (typeof pack_data.img === 'string'){
        //     pack_name = `[${pack_data.name}](http://ipfs.io/ipfs/${pack_data.img})`;
        // }

        let str = `${opener} opened a ${pack_name} pack containing:\n\n`;
        str += this.getString(minted);

        // console.log(str);

        this.sendMessage(str, `http://ipfs.io/ipfs/${pack_data.img}?file=img.png`, telegram_channel);
    }

    async queueTrace(block_num, traces, block_timestamp) {
        let is_unbox, minted, pack_data;
        const pack_accounts = ['kogspack1111', 'gpkcrashpack'];

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
                                if (pack_accounts.includes(action[1].act.account) && action[1].act.name == 'claimunboxed'){
                                    is_unbox = true;
                                    const action_deser = await eos_api.deserializeActions([action[1].act]);
                                    const pack_asset_id = action_deser[0].data.pack_asset_id;
                                    const pack_asset = await atomic.getAsset(pack_asset_id);
                                    pack_data = pack_asset.data;
                                }

                                if (is_unbox && action[1].act.account == 'atomicassets' && action[1].act.name == 'logmint' && action[1].receiver === 'atomicassets'){
                                    // console.log(action[1]);
                                    const action_deser = await eos_api.deserializeActions([action[1].act]);
                                    minted.push(action_deser[0].data);
                                }
                                break;
                        }
                    }

                    if (is_unbox){
                        // console.log(minted);
                        this.processMessage(pack_data, minted);
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
