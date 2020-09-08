const StateReceiver = require('@eosdacio/eosio-statereceiver');
const {Api, JsonRpc, Serialize} = require('eosjs');
const Int64 = require('int64-buffer').Int64BE;
const fetch = require('node-fetch');

const telegram_api_key = require('./secret').telegram_api_key;
const telegram_channel = 'packrips';
const shard_telegram_channel = 'shatnershards';
// const shard_telegram_channel = 'gqjfgtyu';
// const telegram_channel = 'gqjfgtyu';
const telegram_bot = 'packrips_bot';

const pack_images = {
    five: 'https://cloudflare-ipfs.com/ipfs/QmSRti2HK95NXWYG3t3he7UK7hkgw8w9TdqPc6hi5euV1p/packs/standard.jpg',
    thirty: 'https://cloudflare-ipfs.com/ipfs/QmSRti2HK95NXWYG3t3he7UK7hkgw8w9TdqPc6hi5euV1p/packs/mega.jpg',
    exotic5: 'https://cloudflare-ipfs.com/ipfs/QmZBXd6CWeSYc6ZxDcRPC54dwZv4NeSBoRahY8bYDdYPui',
    exotic25: 'https://cloudflare-ipfs.com/ipfs/QmNjTxU8DBN7us9cUt5y9Uju5b7KEQa4Uwj7FhsuAZ79HQ',
    shatnerfive: 'https://gateway.pinata.cloud/ipfs/QmWnNzB7f1EBuA3pisvJ3bMmyVnBv8UYftu7MY2gTVozbo/pack5.png',
    shatnerthirty: 'https://gateway.pinata.cloud/ipfs/QmWnNzB7f1EBuA3pisvJ3bMmyVnBv8UYftu7MY2gTVozbo/pack30.png',
}

const endpoint = 'https://wax.eosdac.io';
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

    getVariantName(index) {
        switch (index){
            case 'tigerborder':
                return 'Tiger Border';
            case 'tigerscratch':
                return 'Tiger Scratch';
        }

        return index.charAt(0).toUpperCase() + index.substr(1).toLowerCase();
    }

    async shatnerCombineString(obj) {
        let str = `${obj.account} combined shards to form a [${obj.cards[0].name} ${obj.cards[0].rarity}](https://cloudflare-ipfs.com/ipfs/${obj.cards[0].img})`;
        str += `\n\n------------------------------\n[Buy packs on shatner.market](https://shatner.market/packs/WSMEGA?referral=mryeateshere)`;

        return str;
    }

    async getString(obj) {
        // special case for combining shatner shards
        if (obj.boxtype === 'shatnercombine'){
            return await this.shatnerCombineString(obj);
        }
        // console.log(`getString`, obj);

        const variant_indexed = {};
        let str = '';

        let pack_name = obj.boxtype;
        if (typeof pack_images[obj.boxtype] === 'string'){
            pack_name = `[${obj.boxtype}](${pack_images[obj.boxtype]})`;
        }
        obj.cards.forEach((c) => {
            if (typeof variant_indexed[c.variant] === 'undefined'){
                variant_indexed[c.variant] = [];
            }
            let prefix = '-';
            // console.log(`card data`, c.id, c);
            if (c.id){
                let quality = c.quality || ` shard ${c.shardid}`;
                if (!c.quality && !c.shardid && `${c.shardid}` !== '0'){
                    quality = '';
                }
                let market = 'gpk';
                if (obj.boxtype.substr(0, 7) === `shatner`){
                    market = 'shatner';
                }
                const card_str = `${prefix} ${c.cardid}${quality} ${c.name} [${c.id.toString().replace('10000000', '')}](https://${market}.market/asset/${c.id}?referral=mryeateshere)`;
                variant_indexed[c.variant].push(card_str);
            }
        });

        if (variant_indexed['collector'] && variant_indexed['collector'].length){
            str += `${siren_light}`;
        }
        else if (variant_indexed['tigerclaw'] && variant_indexed['tigerclaw'].length){
            str += `${siren_light}`;
        }
        else if (variant_indexed['sketch'] && variant_indexed['sketch'].length){
            str += `${joy}`;
        }
        else if (variant_indexed['tigerstripe'] && variant_indexed['tigerstripe'].length){
            str += `${joy}`;
        }
        else if (variant_indexed['prism'] && variant_indexed['prism'].length){
            str += `${smiling}`;
        }
        else if (variant_indexed['base'] && variant_indexed['base'].length) {
            str += `${unhappy}`;
        }

        str += ` ${obj.account} opened an ${pack_name} containing:`;
        for (let vi in variant_indexed){
            str += `\n\n`;
            if (vi !== 'undefined'){
                str += `**${this.getVariantName(vi)}**\n\n`;
            }
            str += variant_indexed[vi].join(`\n`);
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
            shatnerfive: {
                code: 'packs.ws',
                account: 'shatner',
                symbol: 'WSFIVE'
            },
            shatnerthirty: {
                code: 'packs.ws',
                account: 'shatner',
                symbol: 'WSMEGA'
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
        try {
            console.log(str, `getting stats`, obj, lookup[obj.boxtype]);
            const stats = await this.api.rpc.get_currency_stats(lookup[obj.boxtype].code, lookup[obj.boxtype].symbol);
            console.log(stats);
            const balance = await this.api.rpc.get_currency_balance(lookup[obj.boxtype].code, lookup[obj.boxtype].account, lookup[obj.boxtype].symbol);
            const [sold] = balance[0].split(' ');
            const [max] = stats[lookup[obj.boxtype].symbol].max_supply.split(' ');
            const percentage = ((sold / max) * 100).toFixed(1);
            str += `\n\n------------------------------\n${sold} / ${max} \\(${percentage}%\\) ${lookup[obj.boxtype].symbol} packs opened`;
            // str += `\n\n------------------------------\nBuy on collectables.io \\(https://collectables.io/?author\\=${lookup[obj.boxtype].code}&amp;symbol\\=${lookup[obj.boxtype].symbol}&amp;orderby_price\\=asc&amp;tab\\=All%20Listings&amp;ref\\=mryeateshere\\)`
            if (lookup[obj.boxtype].symbol.substr(0, 2) == 'WS'){
                str += `\n\n------------------------------\n[Buy packs on shatner.market](https://shatner.market/packs/${lookup[obj.boxtype].symbol}?referral=mryeateshere)`;
            }
            else {
                str += `\n\n------------------------------\n[Buy packs on gpk.market](https://gpk.market/packs/${lookup[obj.boxtype].symbol}?referral=mryeateshere)`;
            }
        }
        catch (e){
            console.log(e)
            process.exit(1)
        }

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

                                if (code === 'gpk.topps' || code === 'shatner'){

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

                                        if (data.author === 'gpk.topps' || data.author === 'shatner'){
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
                    // console.log(sassets[unboxings[ubid].account]);
                    let tmp = sassets[unboxings[ubid].account];
                    // console.log(`tmp`, tmp);
                    const used_ids = [];
                    for (let c in unboxings[ubid].cards){
                        for (let d in tmp){
                            // console.log(`tmp and card`, tmp[d], unboxings[ubid].cards[c]);
                            if (tmp[d].cardid === unboxings[ubid].cards[c].cardid &&
                                tmp[d].variant === unboxings[ubid].cards[c].variant &&
                                tmp[d].quality === unboxings[ubid].cards[c].quality &&
                                !used_ids.includes(tmp[d].id)){
                                // console.log(tmp[d]);
                                used_ids.push(tmp[d].id);
                                unboxings[ubid].cards[c].name = tmp[d].name;
                                unboxings[ubid].cards[c].id = tmp[d].id;
                                // console.log(`tmp card data`, unboxings[ubid].cards[c]);

                                break;
                            }
                            else if (tmp[d].cardid === unboxings[ubid].cards[c].cardid - 1 &&
                                    typeof tmp[d].variant === 'undefined' &&
                                    !used_ids.includes(tmp[d].id)){
                                // shatner
                                used_ids.push(tmp[d].id);
                                unboxings[ubid].cards[c].name = tmp[d].name;
                                unboxings[ubid].cards[c].rarity = tmp[d].rarity;
                                unboxings[ubid].cards[c].shardid = tmp[d].shardid;
                                unboxings[ubid].cards[c].id = tmp[d].id;
                                unboxings[ubid].cards[c].cardid = tmp[d].cardid;
                                unboxings[ubid].cards[c].img = tmp[d].img;
                                break;
                            }
                        }
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
                    if (unboxings[ubid].cards.length === 1){
                        unboxings[ubid].boxtype = 'shatnercombine';
                    }
                    else if (unboxings[ubid].cards.length > 10){
                        unboxings[ubid].boxtype = 'shatnerthirty';
                    }
                    else if (unboxings[ubid].cards.length > 1){
                        unboxings[ubid].boxtype = 'shatnerfive';
                    }
                    // console.log(`Unboxing cards`, unboxings[ubid].cards.length);
                }
                const channel = (unboxings[ubid].boxtype === 'shatnercombine')?shard_telegram_channel:telegram_channel;
                msg = await this.getString(unboxings[ubid]);
                this.sendMessage(msg, channel);
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
