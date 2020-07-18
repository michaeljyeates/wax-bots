const StateReceiver = require('@eosdacio/eosio-statereceiver');
const {Api, JsonRpc, Serialize} = require('eosjs');
const Int64 = require('int64-buffer').Int64BE;
const fetch = require('node-fetch');

const telegram_api_key = require('./secret').telegram_api_key;
// const telegram_channel = 'packrips';
const telegram_channel = 'gqjfgtyu';
const telegram_bot = 'packrips_bot';

const pack_images = {
    five: 'https://cloudflare-ipfs.com/ipfs/QmSRti2HK95NXWYG3t3he7UK7hkgw8w9TdqPc6hi5euV1p/packs/standard.jpg',
    thirty: 'https://cloudflare-ipfs.com/ipfs/QmSRti2HK95NXWYG3t3he7UK7hkgw8w9TdqPc6hi5euV1p/packs/mega.jpg',
    exotic5: 'https://cloudflare-ipfs.com/ipfs/QmZBXd6CWeSYc6ZxDcRPC54dwZv4NeSBoRahY8bYDdYPui',
    exotic25: 'https://cloudflare-ipfs.com/ipfs/QmNjTxU8DBN7us9cUt5y9Uju5b7KEQa4Uwj7FhsuAZ79HQ',
}

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

    async sendMessage(msg){
        console.log('Sending telegram message', msg);
        const url = `https://api.telegram.org/bot${telegram_api_key}/sendMessage`;
        const msg_obj = {
            chat_id: `@${telegram_channel}`,
            text: msg.replace(/\./g, '\\.').replace(/\-/g, '\\-'), //.replace(/\(/g, '\\(').replace(/\)/g, '\\)'),
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

    getVariantName(index) {
        switch (index){
            case 'tigerborder':
                return 'Tiger Border';
            case 'tigerscratch':
                return 'Tiger Scratch';
        }

        return index.charAt(0).toUpperCase() + index.substr(1).toLowerCase();
    }

    async getString(obj) {
        // console.log(`getString`, obj);
        const variant_indexed = {};
        let str = '';
        let pack_name = obj.boxtype;
        if (typeof pack_images[obj.boxtype] === 'string'){
            pack_name = `[${obj.boxtype}](${pack_images[obj.boxtype]})`;
        }
        str += `${obj.account} opened an ${pack_name} containing:`;
        obj.cards.forEach((c) => {
            if (typeof variant_indexed[c.variant] === 'undefined'){
                variant_indexed[c.variant] = [];
            }
            let prefix = '-';
            variant_indexed[c.variant].push(`${prefix} ${c.cardid}${c.quality} ${c.name} [${c.id}](https://gpk.market/asset/${c.id}?referral=eosdacserver)`);
        });

        for (let vi in variant_indexed){
            str += `\n\n**${this.getVariantName(vi)}**\n\n` + variant_indexed[vi].join(`\n`);
        }

        // Add message with packs opened
        const lookup = {
            five: {
                code: 'packs.topps',
                account: 'gpk.topps',
                symbol: 'GPKFIVE'
            },
            thirty: {
                code: 'packs.topps',
                account: 'gpk.topps',
                symbol: 'GPKMEGA'
            },
            exotic5: {
                code: 'packs.topps',
                account: 'gpk.topps',
                symbol: 'EXOFIVE'
            },
            exotic25: {
                code: 'packs.topps',
                account: 'gpk.topps',
                symbol: 'EXOMEGA'
            },
        };
        const stats = await this.api.rpc.get_currency_stats(lookup[obj.boxtype].code, lookup[obj.boxtype].symbol);
        const balance = await this.api.rpc.get_currency_balance(lookup[obj.boxtype].code, lookup[obj.boxtype].account, lookup[obj.boxtype].symbol);
        const [sold] = balance[0].split(' ');
        const [max] = stats[lookup[obj.boxtype].symbol].max_supply.split(' ');
        str += `\n\n------------------------------\n${sold} / ${max} ${lookup[obj.boxtype].symbol} packs opened`

        return str;
    }

    getCard(data) {
        return {
            cardid: parseInt(data.cardid) + 1,
            variant: data.variant,
            quality: data.quality
        }
    }

    async processDelta(block_num, deltas, abi, block_timestamp) {
        let have_unboxing = false;
        const unboxings = {}, sassets = {};

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

                                if (code === 'gpk.topps'){
                                    // console.info(`Found ${code} delta`);

                                    const scope = sb.getName();
                                    const table = sb.getName();
                                    const primary_key = new Int64(sb.getUint8Array(8)).toString();
                                    const payer = sb.getName();
                                    const data_raw = sb.getBytes();

                                    if (table === 'pendingnft.a' && row.present){
                                        // console.log(`Found unbox for ${scope}`);

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
                                                    unboxingid: data.unboxingid,
                                                    boxtype: data.boxtype,
                                                    account: data.user,
                                                    cards: [ this.getCard(data) ],
                                                    timestamp: block_timestamp
                                                }
                                            }
                                            else {
                                                unboxings[data.unboxingid].cards.push(this.getCard(data));
                                            }
                                        }
                                    }
                                }
                                else if (code === 'simpleassets') {
                                    const scope = sb.getName();
                                    const table = sb.getName();
                                    const primary_key = new Int64(sb.getUint8Array(8)).toString();
                                    const payer = sb.getName();
                                    const data_raw = sb.getBytes();

                                    // console.log(scope);
                                    // console.log(table);

                                    if (table === 'sassets' && row.present) {
                                        // console.log(`Found unbox for ${scope}`);

                                        const table_type = await this.getTableType(code, table);
                                        const data_sb = new Serialize.SerialBuffer({
                                            textEncoder: new TextEncoder,
                                            textDecoder: new TextDecoder,
                                            array: data_raw
                                        });

                                        const data = table_type.deserialize(data_sb);

                                        if (data.author === 'gpk.topps'){
                                            if (typeof sassets[data.owner] === 'undefined'){
                                                sassets[data.owner] = [];
                                            }
                                            const card_data = JSON.parse(data.mdata);
                                            card_data.id = data.id;
                                            sassets[data.owner].push(card_data);
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
                if (typeof sassets[unboxings[ubid].account] !== 'undefined'){
                    console.log(sassets[unboxings[ubid].account]);
                    let tmp = sassets[unboxings[ubid].account];
                    const used_ids = [];
                    for (let c in unboxings[ubid].cards){
                        for (let d in tmp){
                            if (tmp[d].cardid === unboxings[ubid].cards[c].cardid &&
                                tmp[d].variant === unboxings[ubid].cards[c].variant &&
                                tmp[d].quality === unboxings[ubid].cards[c].quality &&
                                !used_ids.includes(tmp[d].id)){
                                // console.log(tmp[d]);
                                used_ids.push(tmp[d].id);
                                unboxings[ubid].cards[c].name = tmp[d].name;
                                unboxings[ubid].cards[c].id = tmp[d].id;

                                break;
                            }
                        }
                    }
                }
                // console.log(unboxings[ubid])
            }

            for (let ubid in unboxings){
                // sort the card data
                unboxings[ubid].cards = unboxings[ubid].cards.sort((a, b) => {
                    return (a.cardid < b.cardid)?-1:1;
                });
                const msg = await this.getString(unboxings[ubid]);
                this.sendMessage(msg);
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
    const start_block = 67187604;

    start(start_block);
}

run();
