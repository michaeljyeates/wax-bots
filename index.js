const StateReceiver = require('@eosdacio/eosio-statereceiver');
const {Api, JsonRpc, Serialize} = require('eosjs');
const Int64 = require('int64-buffer').Int64BE;
const fetch = require('node-fetch');
const card_names = require('./card_names');

const telegram_api_key = require('./secret').telegram_api_key;
const telegram_channel = 'packrips';
const telegram_bot = 'packrips_bot';

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
            text: msg.replace(/\./g, '\\.').replace(/\-/g, '\\-'),
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

    getString(obj) {
        // console.log(`getString`, obj);
        let str = `${obj.account} opened an ${obj.boxtype} containing:\n\n`;
        obj.cards.forEach((c) => {
            str += `- ${c.cardid}${c.quality} ${c.variant} ${this.getCardName(obj.boxtype, c)}\n`;
        });
        return str;
    }

    getCard(data) {
        return {
            cardid: parseInt(data.cardid) + 1,
            variant: data.variant,
            quality: data.quality
        }
    }

    getCardName(series, card_data) {
        let series_key = '';
        switch (series){
            case 'exotic5':
            case 'exotic25':
                series_key = 'exotic';
                break;
            case 'five':
            case 'thirty':
                series_key = 'gpks1';
                break;
        }

        if (series_key){
            // console.log(`Checking for ${series_key} ${card_data.cardid}${card_data.quality}`);
            let card_name = card_names[series_key][`${card_data.cardid}${card_data.quality}`]
            if (typeof card_name === 'undefined'){
                card_name = `Missing card in series ${series_key}`;
            }
            return card_name
        }

        return `Unknown card in series ${series}`;
    }

    async processDelta(block_num, deltas, abi, block_timestamp) {
        let have_unboxing = false;
        const unboxings = {};

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
            for (let ubid in unboxings){
                const msg = this.getString(unboxings[ubid]);
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
    const start_block = 67132000;

    start(start_block);
}

run();
