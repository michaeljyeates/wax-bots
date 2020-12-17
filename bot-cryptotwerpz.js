const StateReceiver = require('@eosdacio/eosio-statereceiver');
const {Api, JsonRpc, Serialize} = require('eosjs');
const Int64 = require('int64-buffer').Int64BE;
const fetch = require('node-fetch');

const telegram_api_key = require('./secret').telegram_api_key;
const telegram_channel = 'packrips';
// const telegram_channel = 'gqjfgtyu';
const telegram_bot = 'packrips_bot';

const endpoint = 'https://wax.eosdac.io';
const eos_rpc = new JsonRpc(endpoint, {fetch});
const eos_api = new Api({ rpc: eos_rpc, signatureProvider:null, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });

const unboxings = {};


const lookup = {
    PNUTPK: {
        img: 'https://cryptotwerpz.com/assets/imgs/Peanuts.gif',
        code: 'peanut',
        name: 'Peanut Pack'
    },
    BNUTZPK: {
        img: 'https://cryptotwerpz.com/assets/imgs/BigNuts.gif',
        code: 'bignutz',
        name: 'Big Nutz Pack'
    },
    PNUTBX: {
        img: 'https://cryptotwerpz.com/assets/imgs/BoxPeanuts.gif',
        code: 'peanutbox',
        name: 'Peanut Box'
    },
    BNUTZBX: {
        img: 'https://cryptotwerpz.com/assets/imgs/BoxBigNutz.gif',
        code: 'bignutzbox',
        name: 'Big Nutz Box'
    }
};

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
        // console.log(resp_json);
        if (!resp_json.ok && resp_json.error_code === 429 && resp_json.parameters.retry_after){
            console.log(`Flooding, try again after ${resp_json.parameters.retry_after}s`)
            setTimeout(() => {
                this.sendMessage(msg, channel);
            }, (resp_json.parameters.retry_after + 1) * 1000);
        }
        else if (!resp_json.ok){
            console.error(resp_json);
        }

        return resp_json
    }

    getString(minted){
        let str = '';
        const items = [];
        minted.forEach(m => {
            const card_data_m = JSON.parse(m.mdata);
            const card_data_i = JSON.parse(m.idata);
            // console.log(card_data_m, card_data_i, m);
            // process.exit(0)
            const market_url = 'https://www.waxplorer.com';
            const market_link = `[${m.assetid}](${market_url}/sale/${m.assetid})`;
            let desc = '';

            const emoji = {
                'Common': '🥜',
                'Simple Re-Fracture': '🌀',
                'Black Death Re-Fracture': '☠️',
                'Nuclear Re-Fracture': '🧪',
                'Twerp-O-Mation': '💎'
            };

            if (typeof emoji[card_data_i.Rarity] !== 'undefined'){
                desc += `${emoji[card_data_i.Rarity]} `;
            }
            desc += card_data_i.name + ' ';
            if (card_data_i.cardnumber){
                desc += card_data_i.cardnumber;
            }
            if (card_data_i.variant){
                desc += card_data_i.variant + ' ';
            }
            if (card_data_i.Rarity){
                desc += '(' + card_data_i.Rarity + ') ';
            }

            items.push(`${this.escapeTelegram(desc)} \\- ${market_link}`);
        });
        str += items.join(`\n`);

        str += `\n`;

        return str;
    }

    escapeTelegram(str){
        return str.replace(/\!/g, '\\!').replace(/\./g, '\\.').replace(/\-/g, '\\-').replace(/\#/g, '\\#').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/=/g, '\\=');
    }

    async processMessage(minted, box_data){
        const opener = box_data.account;
        const pack_data = lookup[box_data.pack_code];
        // console.log(pack_data);
        if (typeof pack_data === 'undefined'){
            console.error(`unknown pack`, box_data.pack_code);
            process.exit(1);
        }


        const pack_name = `[${this.escapeTelegram(pack_data.name)}](${pack_data.img})`;
        let str = `${this.escapeTelegram(opener)} opened a ${pack_name} pack containing:\n\n`;
        str += this.getString(minted);

        this.sendMessage(str, telegram_channel);
    }

    async queueTrace(block_num, traces, block_timestamp) {
        let is_unbox, minted, pack_data, unboxing_id;

        minted = {};
        for (const trace of traces) {
            switch (trace[0]) {
                case 'transaction_trace_v0':
                    const trx = trace[1];
                    is_unbox = false;
                    pack_data = null
                    // console.log(trx)
                    for (let action of trx.action_traces) {
                        //console.log(action)
                        switch (action[0]) {
                            case 'action_trace_v0':
                                if (action[1].act.account === 'simpleassets' && action[1].act.name == 'transferf' && action[1].receiver === 'simpleassets'){
                                    // pending unboxing
                                    const action_deser = await eos_api.deserializeActions([action[1].act]);
                                    const [, pack_code] = action_deser[0].data.quantity.split(' ');
                                    const opener = action_deser[0].data.from;
                                    console.log(`${opener} opened a ${pack_code}`);
                                    unboxings[opener] = pack_code;
                                }
                                if (action[1].act.account == 'simpleassets' && action[1].act.name == 'createlog' && action[1].receiver === 'simpleassets'){
                                    // console.log(action[1]);
                                    const action_deser = await eos_api.deserializeActions([action[1].act]);
                                    if (typeof unboxings[action_deser[0].data.owner] !== 'undefined'){
                                        if (typeof minted[action_deser[0].data.owner] === 'undefined'){
                                            minted[action_deser[0].data.owner] = [];
                                        }
                                        minted[action_deser[0].data.owner].push(action_deser[0].data);
                                        is_unbox = true;
                                    }
                                }
                                break;
                        }
                    }

                    if (is_unbox){
                        // console.log(`is unbox `);
                        // console.log(minted);
                        const minted_accounts = Object.keys(minted);
                        for (let m = 0; m < minted_accounts.length; m++){
                            const account = minted_accounts[m];
                            this.processMessage(minted[account], {account, pack_code: unboxings[account]});
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

    const trace_handler = new TraceHandler({config});
    // const delta_handler = new DeltaHandler({config});

    sr = new StateReceiver({
        startBlock: start_block,
        endBlock: 0xffffffff,
        mode: 0,
        config
    });
    // sr.registerDeltaHandler(delta_handler);
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
