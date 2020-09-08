const StateReceiver = require('@eosdacio/eosio-statereceiver');
const {Api, JsonRpc, Serialize} = require('eosjs');
const Int64 = require('int64-buffer').Int64BE;
const fetch = require('node-fetch');
const { RpcApi } = require('atomicassets');

const telegram_api_key = require('./secret').telegram_api_key;
const telegram_channel = 'packrips';
// const telegram_channel = 'gqjfgtyu';
const telegram_bot = 'packrips_bot';

const pack_images = {
    heropack: 'https://cloudflare-ipfs.com/ipfs/QmS6U7d269tQqV3HRGhbm4YFiKFCbn6FyLAYUZ2otFQEDi/pack5.png',
    titanpack: 'https://cloudflare-ipfs.com/ipfs/QmS6U7d269tQqV3HRGhbm4YFiKFCbn6FyLAYUZ2otFQEDi/pack30.png'
}

const atomicassets_account = 'atomicassets';
const endpoint = 'https://wax.eosdac.io';
const atomic = new RpcApi(endpoint, atomicassets_account, { fetch, rateLimit: 4 });
const eos_rpc = new JsonRpc(endpoint, {fetch});

const siren_light = "🚨";
const smiling = "😄";
const joy = "👌🏽";
const unhappy = "😣";

class DeltaHandler {
    constructor({config}) {
        this.config = config;

        const rpc = new JsonRpc(this.config.eos.endpoint, {fetch});
        this.api = new Api({
            rpc,
            signatureProvider: null,
            chainId: this.config.chainId,
            textDecoder: new TextDecoder(),
            textEncoder: new TextEncoder(),
        });
    }

    async sendMessage(msg, channel){
        console.log('Sending telegram message', msg);
        const url = `https://api.telegram.org/bot${telegram_api_key}/sendMessage`;
        const msg_obj = {
            chat_id: `@${channel}`,
            text: msg.replace(/\!/g, '\\!').replace(/\./g, '\\.').replace(/\-/g, '\\-'), //.replace(/\(/g, '\\(').replace(/\)/g, '\\)'),
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
        console.log(resp_json);
        return resp_json
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

    async getString(obj) {
        let str = '';
        // console.log('getString', obj);

        const has_genesis = obj.cards.find(c => c.rarity === 'genesis');
        if (has_genesis){
            str += siren_light.repeat(10) + `\n`;
        }

        let pack_name = obj.boxtype;
        if (typeof pack_images[obj.boxtype] === 'string'){
            pack_name = `[${obj.boxtype}](${pack_images[obj.boxtype]})`;
        }
        str += ` ${obj.account} opened an ${pack_name} containing:`;

        const card_strings = [];
        obj.cards.forEach((card_data) => {
            const market_link = `[${card_data.id}](https://heroes.market/asset/${card_data.id}?referral=mryeateshere)`;
            const card_str = `${card_data.name} - ${card_data.rarity} ${market_link}`;

            card_strings.push(card_str);
        });

        str += `\n\n` + card_strings.join(`\n`);

        str += `\n\n[View opened pack counts](https://heroes.atomichub.io/tools/overview/bcheroes)`

        return str;
    }

    async processDelta(block_num, deltas, abi, block_timestamp) {
        let have_unboxing = false;
        const unboxings = {}, assets = {};

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

                                if (code === 'unbox.heroes'){

                                    const scope = sb.getName();
                                    const table = sb.getName();
                                    const primary_key = new Int64(sb.getUint8Array(8)).toString();
                                    const payer = sb.getName();
                                    const data_raw = sb.getBytes();


                                    if (table === 'pending.a' && row.present){
                                        console.log(`Found unbox for ${scope}`);
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
                                            have_unboxing = true;
                                            if (typeof unboxings[data.unboxingid] === 'undefined'){
                                                unboxings[data.unboxingid] = {
                                                    series: code,
                                                    account: data.user,
                                                    unboxingid: data.unboxingid,
                                                    cardids: [data.cardid],
                                                    cards: [],
                                                    timestamp: block_timestamp
                                                }
                                            }
                                            else {
                                                unboxings[data.unboxingid].cardids.push(data.cardid);
                                            }
                                        }
                                    }
                                }
                                else if (code === 'atomicassets') {
                                    const scope = sb.getName();
                                    const table = sb.getName();
                                    const primary_key = new Int64(sb.getUint8Array(8)).toString();
                                    const payer = sb.getName();
                                    const data_raw = sb.getBytes();

                                    // console.log(scope);
                                    // console.log(table);

                                    if (table === 'assets' && row.present) {
                                        // console.log(`Found unbox asset for ${scope}`);

                                        const table_type = await this.getTableType(code, table);
                                        const data_sb = new Serialize.SerialBuffer({
                                            textEncoder: new TextEncoder,
                                            textDecoder: new TextDecoder,
                                            array: data_raw
                                        });

                                        const data = table_type.deserialize(data_sb);
                                        // console.log(`card data `, data);

                                        if (data.collection_name === 'officialhero'){
                                            if (typeof assets[scope] === 'undefined'){
                                                assets[scope] = [];
                                            }
                                            // const card_data = JSON.parse(data.mdata);
                                            const card_data = {};
                                            card_data.id = data.asset_id;
                                            card_data.schema_name = data.schema_name;
                                            card_data.template_id = data.template_id;

                                            assets[scope].push(card_data);
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

        if (have_unboxing){
            // console.log(`Processed unboxing`, unboxings);
            // merge the simple assets data
            for (let ubid in unboxings){
                if (typeof assets[unboxings[ubid].account] !== 'undefined'){

                    // console.log('unboxing ', unboxings[ubid], 'assets ', assets[unboxings[ubid].account], ' len ', assets[unboxings[ubid].account].length);


                    for (let a=0; a<assets[unboxings[ubid].account].length; a++){
                        const asset = await atomic.getAsset(unboxings[ubid].account, assets[unboxings[ubid].account][a].id);
                        const card_obj = await asset.toObject();
                        const card_data = card_obj.data;
                        card_data.id = assets[unboxings[ubid].account][a].id;
                        card_data.cardid = parseInt(card_data.cardid);
                        unboxings[ubid].cards.push(card_data);
                    }

                }
                // console.log(unboxings[ubid])
            }

            for (let ubid in unboxings){
                // sort the card data
                let msg = '';
                unboxings[ubid].cards = unboxings[ubid].cards.sort((a, b) => {
                    return (a.cardid < b.cardid)?-1:1;
                });
                if (typeof unboxings[ubid].boxtype === 'undefined'){
                    if (unboxings[ubid].cards.length < 10){
                        unboxings[ubid].boxtype = 'heropack';
                    }
                    else if (unboxings[ubid].cards.length > 10){
                        unboxings[ubid].boxtype = 'titanpack';
                    }
                }

                msg = await this.getString(unboxings[ubid]);
                this.sendMessage(msg, telegram_channel);
            }
        }
    }
}

const start = async (start_block) => {

    const config = require('./config');

    const delta_handler = new DeltaHandler({config});

    sr = new StateReceiver({
        startBlock: start_block,
        endBlock: 0xffffffff,
        mode: 0,
        config
    });
    sr.registerDeltaHandler(delta_handler);
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
