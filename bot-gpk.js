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
const gpk_packs = 'packs.topps';
const gpk_code = 'gpk.topps';
// const gpk_packs = 'oxwxnswsbhzp';
// const gpk_code = 'bhiyveuahwmz';


const lookup = {
    five: {
        img: 'https://cloudflare-ipfs.com/ipfs/QmSRti2HK95NXWYG3t3he7UK7hkgw8w9TdqPc6hi5euV1p/packs/standard.jpg',
        code: 'packs.topps',
        account: 'gpk.topps',
        symbol: 'GPKFIVE',
        name: 'GPK Standard'
    },
    thirty: {
        img: 'https://cloudflare-ipfs.com/ipfs/QmSRti2HK95NXWYG3t3he7UK7hkgw8w9TdqPc6hi5euV1p/packs/mega.jpg',
        code: 'packs.topps',
        account: 'gpk.topps',
        symbol: 'GPKMEGA',
        name: 'GPK Mega'
    },
    shatnerfive: {
        img: 'https://gateway.pinata.cloud/ipfs/QmWnNzB7f1EBuA3pisvJ3bMmyVnBv8UYftu7MY2gTVozbo/pack5.png',
        code: 'packs.ws',
        account: 'shatner',
        symbol: 'WSFIVE',
        name: 'Shatner Five'
    },
    shatnerthirty: {
        img: 'https://gateway.pinata.cloud/ipfs/QmWnNzB7f1EBuA3pisvJ3bMmyVnBv8UYftu7MY2gTVozbo/pack30.png',
        code: 'packs.ws',
        account: 'shatner',
        symbol: 'WSMEGA',
        name: 'Shatner Mega'
    },
    exotic5: {
        img: 'https://cloudflare-ipfs.com/ipfs/QmZBXd6CWeSYc6ZxDcRPC54dwZv4NeSBoRahY8bYDdYPui',
        code: 'packs.topps',
        account: 'gpk.topps',
        symbol: 'EXOFIVE',
        name: 'Exotic Standard'
    },
    exotic25: {
        img: 'https://cloudflare-ipfs.com/ipfs/QmNjTxU8DBN7us9cUt5y9Uju5b7KEQa4Uwj7FhsuAZ79HQ',
        code: 'packs.topps',
        account: 'gpk.topps',
        symbol: 'EXOMEGA',
        name: 'Exotic Mega'
    },
    gpktwo55: {
        img: 'https://cloudflare-ipfs.com/ipfs/QmWkB8bBEoHai7Li5jHdUbavFKxnfQmVvGJj5ytyWpNbUt/3.jpg',
        code: gpk_packs,
        account: gpk_code,
        symbol: 'GPKTWOC',
        name: 'GPK S2 Ultimate'
    },
    gpktwo25: {
        img: 'https://cloudflare-ipfs.com/ipfs/QmWkB8bBEoHai7Li5jHdUbavFKxnfQmVvGJj5ytyWpNbUt/2.jpg',
        code: gpk_packs,
        account: gpk_code,
        symbol: 'GPKTWOB',
        name: 'GPK S2 Mega'
    },
    gpktwoeight: {
        img: 'https://cloudflare-ipfs.com/ipfs/QmWkB8bBEoHai7Li5jHdUbavFKxnfQmVvGJj5ytyWpNbUt/1.jpg',
        code: gpk_packs,
        account: gpk_code,
        symbol: 'GPKTWOA',
        name: 'GPK S2 Standard'
    }
};


class DeltaHandler {
    constructor({config}) {
        this.config = config;

        const rpc = eos_rpc;
        this.api = eos_api;
    }

    async getTableType(code, table) {
        const contract = await this.api.getContract(code);
        const abi = await this.api.getAbi(code);

        // this.logger.info(abi)

        let this_table, type;
        for (let t of abi.tables) {
            if (t.name === table) {
                this_table = t;
                break
            }
        }

        if (this_table) {
            type = this_table.type
        } else {
            this.logger.error(`Could not find table "${table}" in the abi`, {code, table});
            return
        }

        return contract.types.get(type)
    }

    async processDelta(block_num, deltas, abi, block_timestamp) {
        let have_unboxing = false;
        // const unboxings = {}, sassets = {};

        for (const delta of deltas) {
            // this.logger.info(delta)
            switch (delta[0]) {
                case 'table_delta_v0':
                    if (delta[1].name === 'contract_row') {
                        // continue
                        for (const row of delta[1].rows) {

                            const sb = new Serialize.SerialBuffer({
                                textEncoder: new TextEncoder,
                                textDecoder: new TextDecoder,
                                array: row.data
                            });


                            let code;
                            try {
                                // this.logger.info(`row`, row);
                                sb.get(); // ?
                                code = sb.getName();
                                // console.log(code);

                                if (code === gpk_code){//} || code === 'shatner'){

                                    const scope = sb.getName();
                                    const table = sb.getName();
                                    const primary_key = new Int64(sb.getUint8Array(8)).toString();
                                    const payer = sb.getName();
                                    const data_raw = sb.getBytes();


                                    if ((table === 'pendingnft.a' || table === 'pending.m') && row.present){
                                        // console.log(`Found unbox for ${scope}`);
                                        // console.info(`Found ${code} delta on table ${table}`);

                                        const table_type = await this.getTableType(code, table);
                                        const data_sb = new Serialize.SerialBuffer({
                                            textEncoder: new TextEncoder,
                                            textDecoder: new TextDecoder,
                                            array: data_raw
                                        });

                                        const data = table_type.deserialize(data_sb);
                                        if (data.done){
                                            // console.log(data);
                                            // have_unboxing = true;
                                            // console.log('have unboxing id', data);
                                            // process.exit(0)
                                            if (typeof unboxings[data.unboxingid] === 'undefined'){
                                                unboxings[data.unboxingid] = {
                                                    unboxingid: data.unboxingid,
                                                    boxtype: data.boxtype,
                                                    account: data.user,
                                                    timestamp: block_timestamp
                                                }
                                            }
                                        }
                                    }
                                }
                            } catch (e) {
                                console.error(`Error processing row.data for ${block_num} : ${e.message}`, e);
                            }
                        }
                    }
                    break
            }
        }

    }
}


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

    getString(minted){
        let str = '';
        const items = [];
        minted.forEach(m => {
            const card_data = JSON.parse(m.mdata);
            const market_url = 'https://gpk.market';
            const market_link = `[${m.assetid}](${market_url}/asset/${m.assetid}?referral=mryeateshere)`;
            let desc = '';

            const emoji = {
                collector: '💎',
                relic: '🔥',
                error: '🚫',
                originalart: '🎨',
                vhs: '📼',
                slime: '🤢',
                gum: '💕',
                sketch: '✏️',
                returning: '✨',
                raw: '🖼',
            }

            if (typeof emoji[card_data.variant] !== 'undefined'){
                desc += `${emoji[card_data.variant]} `;
            }
            if (card_data.cardid && card_data.quality){
                desc += `${card_data.cardid}${card_data.quality} `;
            }
            else if (card_data.cardid){
                desc += `${card_data.cardid} `;
            }
            desc += card_data.name + ' ';
            if (card_data.variant){
                desc += card_data.variant + ' ';
            }
            if (card_data.mint){
                desc += `#${card_data.mint} `;
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

    async processMessage(minted, box_data){
        const opener = box_data.account;
        const pack_data = lookup[box_data.boxtype];
        // console.log(pack_data);


        const pack_name = this.escapeTelegram(`[${pack_data.name}](${pack_data.img})`);
        let str = `${this.escapeTelegram(opener)} opened a ${pack_name} pack containing:\n\n`;
        str += this.escapeTelegram(this.getString(minted));

        this.sendMessage(str, telegram_channel);
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
                                if (action[1].act.account === gpk_code && action[1].act.name == 'getcards'){
                                    const action_deser = await eos_api.deserializeActions([action[1].act]);
                                    unboxing_id = action_deser[0].data.unboxing;
                                    is_unbox = true;
                                }

                                if (is_unbox && action[1].act.account == 'simpleassets' && action[1].act.name == 'createlog' && action[1].receiver === 'simpleassets'){
                                    // console.log(action[1]);
                                    const action_deser = await eos_api.deserializeActions([action[1].act]);
                                    minted.push(action_deser[0].data);
                                }
                                break;
                        }
                    }

                    if (is_unbox){
                        // console.log(`is unbox `, unboxing_id);
                        // console.log(minted);
                        // console.log(unboxings[unboxing_id]);
                        // process.exit(0)
                        if (typeof unboxings[unboxing_id] === 'undefined'){
                            console.log(`No unboxing data for ${unboxing_id}`);
                            setTimeout(() => {
                                this.processMessage(minted, unboxings[unboxing_id]);
                            }, 3000);
                        }
                        else {
                            this.processMessage(minted, unboxings[unboxing_id]);
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
    const delta_handler = new DeltaHandler({config});

    sr = new StateReceiver({
        startBlock: start_block,
        endBlock: 0xffffffff,
        mode: 0,
        config
    });
    sr.registerDeltaHandler(delta_handler);
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
