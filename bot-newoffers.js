const StateReceiver = require('@eosdacio/eosio-statereceiver');
const {Api, JsonRpc, Serialize} = require('eosjs');
const Int64 = require('int64-buffer').Int64BE;
const fetch = require('node-fetch');
const { ExplorerApi } = require('atomicassets');

const telegram_api_key = require('./secret').telegram_api_key;
const telegram_channel = 'nftoffers';
const first_telegram_channel = 'nftfirstmint';
// const telegram_channel = 'gqjfgtyu';
// const first_telegram_channel = 'gqjfgtyu';
const telegram_bot = 'packrips_bot';

const atomicassets_account = 'atomicassets';
const atomicmarket_account = 'atomicmarket';
const endpoint = 'https://wax.eosdac.io';
const atomic_endpoint = 'https://wax.api.atomicassets.io';
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
        // console.log(resp_json);
        if (!resp_json.ok && resp_json.error_code === 429 && resp_json.parameters.retry_after){
            console.log(`Flooding, try again after ${resp_json.parameters.retry_after}s`)
            setTimeout(() => {
                this.sendMessage(msg, channel);
            }, (resp_json.parameters.retry_after + 1) * 1000);
        }
        // console.log(resp_json);

        return resp_json
    }

    getString(sale_data){
        const seller = sale_data.seller;
        let str = `${seller} offered to sell:`;

        for (let a=0; a < sale_data.assets.length; a++){
            const asset = sale_data.assets[a];
            let img = asset.data.img;
            if (img.substr(0,1) === 'Q'){
                img = `https://ipfs.io/ipfs/${img}`
            }
            str += `\n\nName: [${asset.name}](${img})\n`;
            let mint = '';
            if (asset.template && !asset.original_mint){
                let max_supply = asset.template.max_supply;
                if (asset.template.max_supply === 0){
                    max_supply = '∞';
                }
                mint = `${asset.template_mint} / ${asset.template.issued_supply} \\(max ${max_supply}\\)`;

                str += `Mint: ${mint}\n`
            }
            else if (asset.original_mint){
                str += `Mint: ${asset.original_mint}\n`
            }
        }

        str += `\nPrice: ${sale_data.listing_price}`;
        str += `\n\n[Buy on Atomic Hub](https://wax.atomichub.io/market/sale/${sale_data.sale_id})`;

        return str;
    }

    escapeTelegram(str){
        return str.replace(/\!/g, '\\!').replace(/\./g, '\\.').replace(/\-/g, '\\-').replace(/\#/g, '\\#');
    }

    async getGPKMint(sassets_id) {
        const res = await eos_rpc.get_table_rows({
            code: 'simpleassets',
            scope: 'atomicbridge',
            table: 'sassets',
            lower_bound: sassets_id,
            upper_bound: sassets_id
        });

        let mint = 0;

        if (res.rows && res.rows.length){
            const mdata = JSON.parse(res.rows[0].mdata);
            mint = parseInt(mdata.mint);
        }

        return mint;
    }

    async processMessage(sale_data){
        const assets = [];
        for (let a=0;a<sale_data.asset_ids.length;a++){
            const aid = sale_data.asset_ids[a];
            // console.log(aid, sale_data);
            const aa = await atomic.getAsset(aid);
            if (aa.data.sassets_id){
                aa.original_mint = await this.getGPKMint(aa.data.sassets_id);
                aa.template_mint = '0';
            }
            assets.push(aa);
        }

        sale_data.assets = assets;
        // console.log(assets);

        // const pack_name = this.escapeTelegram(`[${pack_data.name}](${pack_data.img})`);
        const msg = this.escapeTelegram(this.getString(sale_data));
        this.sendMessage(msg, telegram_channel);

        for (let a = 0; a < assets.length; a++){
            console.log(assets[a]);
            if (assets[a].template_mint === '1' && assets[a].collection && assets[a].collection.collection_name !== 'kogsofficial'){
                this.sendMessage(msg, first_telegram_channel);
            }
        }
    }

    async processTrace(block_num, traces, block_timestamp) {
        let is_unbox, minted, pack_data, unboxing_id;

        for (const trace of traces) {
            switch (trace[0]) {
                case 'transaction_trace_v0':
                    const trx = trace[1];
                    let sale_data = null;
                    let is_new_offer = false;

                    for (let action of trx.action_traces) {
                        //console.log(action)
                        switch (action[0]) {
                            case 'action_trace_v0':
                                if (action[1].act.account === atomicmarket_account && action[1].act.name == 'lognewsale'){
                                    const action_deser = await eos_api.deserializeActions([action[1].act]);
                                    sale_data = action_deser[0].data;
                                }
                                else if (action[1].act.account === atomicmarket_account && action[1].act.name == 'logsalestart'){
                                    is_new_offer = true;
                                }
                                break;
                        }
                    }

                    if (is_new_offer){
                        // console.log(`new sale `, sale_data);
                        this.processMessage(sale_data);
                    }

                    break;
            }
        }
    }

}


const start = async (start_block) => {

    const config = require('./config');

    const delta_handler = new TraceHandler({config});

    sr = new StateReceiver({
        startBlock: start_block,
        endBlock: 0xffffffff,
        mode: 0,
        config
    });
    sr.registerTraceHandler(delta_handler);
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
