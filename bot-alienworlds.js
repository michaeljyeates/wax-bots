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
const atomic_endpoint = 'https://wax.api.atomicassets.io';
const endpoint = 'https://wax.eosdac.io';
const eos_rpc = new JsonRpc(endpoint, {fetch});
const eos_api = new Api({ rpc: eos_rpc, signatureProvider:null, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
const atomic = new ExplorerApi(atomic_endpoint, atomicassets_account, { fetch, rateLimit: 4 });

const lookup = {
    base: {
        img: 'https://cloudflare-ipfs.com/ipfs/QmXLHNLJUiQcNGBnGqQyNvabwvEVTZ4XspjT6vKmtFHFo6',
        code: 'pack.worlds',
        account: 'open.worlds',
        symbol: 'BASE',
        name: 'Standard Launch Pack'
    },
    promo: {
        img: 'https://cloudflare-ipfs.com/ipfs/QmNtrFMbGydFqFuZdZKvGnzCDKmkjVrkeMKUoS9JhJWiYR',
        code: 'pack.worlds',
        account: 'open.worlds',
        symbol: 'PROMO',
        name: 'Special Promo Pack'
    },
    rare: {
        img: 'https://cloudflare-ipfs.com/ipfs/QmX7w4mpEXSSZXEffzZ3jmDSUGR6E14vFUPEMMtomwe9XZ',
        code: 'pack.worlds',
        account: 'open.worlds',
        symbol: 'RARE',
        name: 'Rare Launch Pack'
    },
    leg: {
        img: 'https://cloudflare-ipfs.com/ipfs/QmVWZgQmNCfRuojyQnj8BTtFJ4eVcYy9RUbAiUc5cF6xsm',
        code: 'pack.worlds',
        account: 'open.worlds',
        symbol: 'LEG',
        name: 'Legendary Launch Pack'
    },
    land: {
        img: 'https://cloudflare-ipfs.com/ipfs/QmSpntMJhgeaWmapmYYEsAymyZL2ZTHErZniMtausTTx9X',
        code: 'pack.worlds',
        account: 'open.worlds',
        symbol: 'LAND',
        name: 'Special Land Launch Pack'
    },
    dacpro: {
        img: 'https://cloudflare-ipfs.com/ipfs/QmQ11mhSpoKnF3Juz3i9HjWfw8xBgNGoyMjqyuAJWRySHs',
        code: 'pack.worlds',
        account: 'open.worlds',
        symbol: 'DACPRO',
        name: 'eosDAC Promo Pack'
    },
    dacexc: {
        img: 'https://cloudflare-ipfs.com/ipfs/QmbLCA1kVcks7ES9MdMRtuswwsZ8dM53ATLtHr4skTJuqy',
        code: 'pack.worlds',
        account: 'open.worlds',
        symbol: 'DACEXC',
        name: 'eosDAC Exclusive Pack'
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
            let card_data = m.data;
            if (!m.data){
                card_data = this.normaliseTemplateData(m.immutable_template_data);
            }

            const market_url = 'https://wax.atomichub.io';
            const market_link = `[${m.asset_id}](${market_url}/explorer/asset/${m.asset_id})`;
            let desc = '';

            const emoji = {
                Common: '🍪',
                Rare: '🧿',
                Epic: '🔮',
                Legendary: '⭐️',
                Mythical: '🔥💎',
                XDimension: '🛸',
                land: '🏝'
            }

            if (m.schema && m.schema.schema_name === 'land.worlds'){
                desc += `${emoji['land']}`;
            }
            if (typeof emoji[card_data.shine] !== 'undefined'){
                desc += `${emoji[card_data.shine]} `;
            }
            else if (typeof emoji[card_data.rarity] !== 'undefined'){
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
        return str.replace(/\!/g, '\\!').replace(/\./g, '\\.').replace(/\-/g, '\\-').replace(/\#/g, '\\#');
    }

    async processMessage(minted, pack_name){
        const opener = minted[0].new_asset_owner;
        const pack_data = lookup[pack_name];

        const pack_name_str = this.escapeTelegram(`[${pack_data.name}](${pack_data.img})`);
        let str = `${this.escapeTelegram(opener)} opened a ${pack_name_str} pack containing:\n\n`;
        str += this.escapeTelegram(this.getString(minted));

        // console.log(str);

        this.sendMessage(str, telegram_channel);
    }

    async queueTrace(block_num, traces, block_timestamp) {
        let is_unbox, minted, pack_data, pack_name;

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
                                if (action[1].act.account === 'open.worlds' && action[1].act.name == 'claim'){
                                    const action_deser = await eos_api.deserializeActions([action[1].act]);
                                    pack_name = action_deser[0].data.pack_name;
                                    is_unbox = true;
                                }
                                else if (is_unbox && action[1].act.account === 'atomicassets' && action[1].act.name == 'logmint' && action[1].receiver == 'atomicassets'){
                                    const action_deser = await eos_api.deserializeActions([action[1].act]);
                                    minted.push(action_deser[0].data);
                                }
                                else if (is_unbox && action[1].act.account === 'atomicassets' && action[1].act.name == 'logtransfer' && action[1].receiver == 'atomicassets'){
                                    const action_deser = await eos_api.deserializeActions([action[1].act]);
                                    const asset_id = action_deser[0].data.asset_ids[0];
                                    const asset = await atomic.getAsset(asset_id);
                                    // console.log(`transfer!!!`, asset);
                                    // process.exit(0)
                                    minted.push(asset);
                                }
                                break;
                        }
                    }

                    if (is_unbox){
                        console.log(`is unbox ${pack_name}`, minted.length, minted);
                        this.processMessage(minted, pack_name);
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
