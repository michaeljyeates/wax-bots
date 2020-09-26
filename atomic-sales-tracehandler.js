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
        // console.log(json);
        return json.data[0];
    }



    async process_atomic(buyer, seller, quantity, asset_id, retries = 0) {
        if (retries >= 10){
            console.log(`Giving up on ${asset_id}`);
            return;
        }
        console.log(`${buyer} paid ${quantity} to ${seller} for ${asset_id}`);
        const asset = await this.get_atomic_data(buyer, asset_id);
        // console.log(asset);
        if (!asset){
            retries++;
            // console.log(`Couldnt get asset data`);
            setTimeout(() => {
                this.process_atomic(buyer, seller, quantity, asset_id, retries);
            }, 3000);
            return;
        }

        this.notify.forEach((n) => {
            n.sale('atomic', buyer, seller, quantity, asset);
        });

    }

    async process_myth(asset){
        console.log(asset);
        const asset_data = JSON.parse(asset.mdata);
        asset_data.asset_id = asset.assetid;
        asset_data.category = asset.category;
        asset_data.author = asset.author;

        console.log(`${asset.buyer} paid ${asset.price} to ${asset.seller} for ${asset.assetid}`);

        this.notify.forEach((n) => {
            n.sale('myth', asset.buyer, asset.seller, asset.price, asset_data);
        });
    }

    async queueTrace(block_num, traces, block_timestamp) {

        const atomic_sale_traces = [], myth_sale_traces = [], collectables_sale_traces = [];

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
                                else if (action[1].act.account === 'market.myth' && action[1].act.name === 'logsale' && action[1].receiver === 'market.myth'){
                                    myth_sale_traces.push(action[1].act);
                                    continue;
                                }
                                else if (action[1].act.account === 'market.place' && action[1].act.name === 'buy'){
                                    collectables_sale_traces.push(trx);
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

                    await this.process_atomic(buyer, seller, quantity, asset_id);
                }
                else {
                    console.error(`First action wasnt transfer in ${st.id}`);
                }
            });

            // process.exit(0)
        }

        if (myth_sale_traces.length){
            myth_sale_traces.forEach(ms => {
                const act = this.eos_api.deserializeActions([ms]).then(act => {
                    console.log(act[0]);
                    this.process_myth(act[0].data);
                });
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
