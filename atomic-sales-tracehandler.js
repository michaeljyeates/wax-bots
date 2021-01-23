const {Api, JsonRpc, Serialize} = require('eosjs');
const fetch = require('node-fetch');
const { TextDecoder, TextEncoder } = require('text-encoding');

class TraceHandler {
    constructor({config}) {
        this.config = config;
        this.notify = [];
        this.eos_rpc = new JsonRpc(config.eos.endpoint, {fetch});
        this.eos_api = new Api({ rpc: this.eos_rpc, signatureProvider:null, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
    }

    add_sale_notify(handler){
        this.notify.push(handler);
    }

    async get_atomic_data(owner, asset_id) {
        const url = `${this.config.atomic_endpoint}/atomicassets/v1/assets?owner=${owner}&ids=${asset_id}&page=1&limit=1`;
        const res = await fetch(url);
        const json = await res.json();
        if (!json.data){
            console.error(`Failed to get data for ${asset_id}`, json);
            return;
        }
        // console.log(json);
        return json.data[0];
    }

    async get_simple_data(owner, asset_id) {
        const res = await this.eos_rpc.get_table_rows({code: 'simpleassets', scope: owner, table: 'sassets', lower_bound: asset_id, upper_bound: asset_id, limit: 1});

        if (res.rows.length){
            const asset = res.rows[0];
            let mdata = {}, idata = {};
            if (asset.mdata){
                mdata = JSON.parse(asset.mdata);
            }
            if (asset.idata){
                idata = JSON.parse(asset.idata);
            }
            asset.data = Object.assign(mdata, idata);
            return asset;
        }

        return null;
    }



    async process_atomic(buyer, seller, quantity, asset_id, block_num, block_timestamp, retries = 0) {
        if (retries >= 10){
            console.log(`Giving up on ${asset_id}`);
            return;
        }
        // console.log(`${buyer} paid ${quantity} to ${seller} for ${asset_id}`);
        const asset = await this.get_atomic_data(buyer, asset_id);
        // console.log(asset);
        if (!asset){
            retries++;
            // console.log(`Couldnt get asset data`);
            setTimeout(() => {
                this.process_atomic(buyer, seller, quantity, asset_id, block_num, block_timestamp, retries);
            }, 3000);
            return;
        }

        this.notify.forEach((n) => {
            n.sale('atomic', buyer, seller, quantity, asset, block_num, block_timestamp);
        });

    }

    async process_myth(asset, block_num, block_timestamp){
        // console.log(asset);
        const asset_data = JSON.parse(asset.mdata);
        asset_data.asset_id = asset.assetid;
        asset_data.category = asset.category;
        asset_data.author = asset.author;

        // console.log(`${asset.buyer} paid ${asset.price} to ${asset.seller} for ${asset.assetid}`);

        this.notify.forEach((n) => {
            n.sale('myth', asset.buyer, asset.seller, asset.price, asset_data, block_num, block_timestamp);
        });
    }

    async process_simple(data, block_num, block_timestamp){
        // console.log(data);
        const buyer = data.from;
        const sale_data = JSON.parse(data.assets_seller);
        // console.log(sale_data);
        for (const seller in sale_data){
            for (let i=0; i < sale_data[seller].length; i++){
                const asset_id = sale_data[seller][i][0];
                const quantity = sale_data[seller][i][1];

                const asset = await this.get_simple_data(buyer, asset_id);
                if (!asset){
                    console.log(`Failed to parse simpleasset ${asset_id}, owned by ${buyer}`);
                    continue;
                }
                const asset_data = asset.data;
                // console.log(`${buyer} paid ${quantity} to ${seller} for ${asset.id}`);

                asset_data.asset_id = asset_id;
                asset_data.category = asset.category;
                asset_data.author = asset.author;

                this.notify.forEach((n) => {
                    n.sale('simple', buyer, seller, quantity, asset_data, block_num, block_timestamp);
                });
            }
        }
    }

    async process_waxstash(data, block_num, block_timestamp){
        const asset = await this.get_simple_data(data.buyer, data.asset_id);
        const asset_data = asset.data;
        console.log(`${data.buyer} paid ${data.quantity} to ${data.seller} for ${data.asset_id}`);

        asset_data.asset_id = data.asset_id;
        asset_data.category = asset.category;
        asset_data.author = asset.author;

        this.notify.forEach((n) => {
            n.sale('waxstash', data.buyer, data.seller, data.quantity, asset_data, block_num, block_timestamp);
        });
    }

    async queueTrace(block_num, traces, block_timestamp) {

        const atomic_sale_traces = [], atomic_drop_traces = [], myth_sale_traces = [], collectables_sale_traces = [], simple_sale_traces = [], waxstash_sale_traces = [];

        for (const trace of traces) {
            switch (trace[0]) {
                case 'transaction_trace_v0':
                    const trx = trace[1];
                    // console.log(trx)
                    for (let action of trx.action_traces) {
                        //console.log(action)
                        switch (action[0]) {
                            case 'action_trace_v0':
                                if (action[1].act.account === 'atomicmarket' && action[1].act.name === 'purchasesale'){
                                    atomic_sale_traces.push(trx);
                                    continue;
                                }
                                else if (action[1].act.account === 'atomicdropsx' && action[1].act.name === 'assertdrop'){
                                    atomic_drop_traces.push(trx);
                                    continue;
                                }
                                else if (action[1].act.account === 'market.myth' && action[1].act.name === 'logsale' && action[1].receiver === 'market.myth'){
                                    myth_sale_traces.push(action[1].act);
                                    continue;
                                }
                                else if (action[1].act.account === 'simplemarket' && action[1].act.name === 'buylog'){
                                    simple_sale_traces.push(action[1].act);
                                    continue;
                                }
                                else if (action[1].act.account === 'eosio.token' && action[1].act.name === 'transfer'){
                                    const sb = new Serialize.SerialBuffer({
                                        textEncoder: new TextEncoder,
                                        textDecoder: new TextDecoder,
                                        array: action[1].act.data
                                    });
                                    const from = sb.getName();
                                    const to = sb.getName();

                                    if (to === 'waxstashsale'){
                                        waxstash_sale_traces.push(trx);
                                    }
                                    continue;
                                }
                                break;
                        }
                    }
                    break;
            }
        }

        if (atomic_sale_traces.length){
            atomic_sale_traces.forEach(async st => {
                let payment_action = st.action_traces[0][1];
                if (payment_action.act.account === 'res.pink'){
                    payment_action = st.action_traces[1][1];
                }

                if (payment_action.act.account === 'eosio.token'){
                    // console.log(`Found sale`, payment_action);

                    const sb = new Serialize.SerialBuffer({
                        textEncoder: new TextEncoder,
                        textDecoder: new TextDecoder,
                        array: payment_action.act.data
                    });

                    const buyer = sb.getName();
                    sb.getName();
                    const quantity = sb.getAsset();


                    // get seller and asset id
                    let seller, asset_id;
                    for (let action of st.action_traces) {
                        switch (action[0]) {
                            case 'action_trace_v0':
                                if (action[1].act.account === 'eosio.token' && action[1].act.name === 'transfer'){
                                    const sb_withdraw = new Serialize.SerialBuffer({
                                        textEncoder: new TextEncoder,
                                        textDecoder: new TextDecoder,
                                        array: action[1].act.data
                                    });

                                    sb_withdraw.getName(); // from
                                    const potential_seller = sb_withdraw.getName();
                                    sb_withdraw.getAsset(); // quantity
                                    const memo = sb_withdraw.getString();
                                    if (memo.indexOf('Payout') > -1){
                                        seller = potential_seller;
                                    }
                                }
                                else if (action[1].act.account === 'atomicassets' && action[1].act.name === 'transfer'){
                                    const sb_transfer = new Serialize.SerialBuffer({
                                        textEncoder: new TextEncoder,
                                        textDecoder: new TextDecoder,
                                        array: action[1].act.data
                                    });

                                    sb_transfer.getName();
                                    sb_transfer.getName();
                                    sb_transfer.get(); // vector length (assumed to be 1)
                                    asset_id = sb_transfer.getUint64AsNumber();
                                }
                                break;
                        }
                    }

                    await this.process_atomic(buyer, seller, quantity, asset_id, block_num, block_timestamp);
                }
                else {
                    console.error(`First action wasnt transfer in ${st.id}`);
                }
            });

            // process.exit(0)
        }

        if (atomic_drop_traces.length){
            let quantity, asset_id, buyer, seller;
            for (let d = 0; d < atomic_drop_traces.length; d++){
                const dt = atomic_drop_traces[d];
                // console.log(dt);

                for (let a = 0; a < dt.action_traces.length; a++){
                    const act = dt.action_traces[a];
                    // console.log('drop action', act[1].act);
                    if (act[1].act.name === 'assertdrop' && act[1].act.account === 'atomicdropsx'){
                        const deser_acts = await this.eos_api.deserializeActions([act[1].act]);
                        // console.log('assertdrop action', deser_acts[0]);
                        quantity = deser_acts[0].data.listing_price_to_assert;
                        if (quantity === '0 NULL'){
                            quantity = 'FREE';
                        }
                    }
                    else if (act[1].act.name === 'logmint' && act[1].act.account === 'atomicassets'){
                        const deser_acts = await this.eos_api.deserializeActions([act[1].act]);
                        asset_id = deser_acts[0].data.asset_id;
                        buyer = deser_acts[0].data.new_asset_owner;
                        seller = deser_acts[0].data.collection_name;
                    }
                }
            }
            // process.exit(0)

            await this.process_atomic(buyer, seller, quantity, asset_id, block_num, block_timestamp);
        }

        if (myth_sale_traces.length){
            myth_sale_traces.forEach(ms => {
                const act = this.eos_api.deserializeActions([ms]).then(act => {
                    // console.log(act[0]);
                    this.process_myth(act[0].data, block_num, block_timestamp);
                });
            });
        }

        if (simple_sale_traces.length){
            simple_sale_traces.forEach(ms => {
                const act = this.eos_api.deserializeActions([ms]).then(act => {
                    // console.log(act[0].data);
                    this.process_simple(act[0].data, block_num, block_timestamp);
                });
            });
        }

        if (waxstash_sale_traces.length){
            waxstash_sale_traces.forEach(trx => {
                // console.log(trx)
                let seller, buyer, asset_id, quantity;
                trx.action_traces.forEach(a => {
                    if (a[1].act.account === 'eosio.token' && a[1].act.name === 'transfer'){
                        const sb = new Serialize.SerialBuffer({
                            textEncoder: new TextEncoder,
                            textDecoder: new TextDecoder,
                            array: a[1].act.data
                        });
                        const from = sb.getName();
                        const to = sb.getName();
                        const qty = sb.getAsset();
                        const memo = sb.getString();

                        if (to === 'waxstashsale' && memo.indexOf(' Author:') > -1){
                            buyer = from;
                            quantity = qty;
                            const [asset_str] = memo.split(' ');
                            asset_id = asset_str.replace('Id:', '');
                        }
                        else if (memo.indexOf('SOLD ASSET') > -1){
                            seller = to;
                        }
                    }
                });

                if (seller && buyer && asset_id && quantity){
                    this.process_waxstash({ seller, buyer, asset_id, quantity }, block_num, block_timestamp);
                }
            });
        }

        /*if (collectables_sale_traces.length){
            collectables_sale_traces.forEach(trx => {
                console.log(trx);
            });
        }*/
    }

    async processTrace(block_num, traces, block_timestamp) {
        // console.log(`Process block ${block_num}`)
        return this.queueTrace(block_num, traces, block_timestamp);
    }

}

module.exports = { TraceHandler }
