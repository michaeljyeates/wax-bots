const StateReceiver = require('@eosdacio/eosio-statereceiver');
const {Api, JsonRpc, Serialize} = require('eosjs');
const Int64 = require('int64-buffer').Int64BE;
const fetch = require('node-fetch');
const { TextDecoder, TextEncoder } = require('text-encoding');

const telegram_api_key = require('./secret').telegram_api_key;
const telegram_channel = 'waxdidsomething';
// const telegram_channel = 'gqjfgtyu';
const telegram_bot = 'packrips_bot';

const endpoint = 'https://wax.eosdac.io';
const eos_rpc = new JsonRpc(endpoint, {fetch});
const eos_api = new Api({ rpc: eos_rpc, signatureProvider:null, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
const sleep = async (ms) => {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
};


const wax_accounts = [
    'eosio',
    'wax',
    'admin.wax',
    'admin2.wax',
    'admin3.wax',
    'admin4.wax',
    'worker.wax',
    'mason.wax',
    'hornet.wax',
    'wasp.wax',
    'apoidea.wax',
    'apidae.wax',
    'royal.wax',
    'busy.wax',
    'vespidae.wax',
    'bee.wax',
    'royal.wax',
    'nft.wax',
    '.enai.waa', // main voter
    '4tioi.waa',
    'explodingkit',
    'waltdisneyco',
    'eth',
    'bridge.eth',
    'orderorderor',
    'waxe',
    '.enai.waa',
    'ar2am.wam',
    'ldrbrd.nft'
];

const ignored_actions = [
    'onblock',
    'voteproducer',
    'claimgenesis',
    'claimgbmvote',
    'delegatebw'
];


class TraceHandler {
    constructor({config}) {
        this.config = config;
        this.actions = [];
        this.queue = [];

        setInterval(this.process_messages.bind(this), 5000);
    }

    async process_messages() {
        const messages = [];

        for (let a=0; a<this.actions.length; a++){
            // console.log(this.actions[a]);
            const actions = await eos_api.deserializeActions([this.actions[a].action.act]);
            const action = actions[0];
            // console.log(action)
            switch (action.account){
                case 'eosio.msig':
                    if (action.name === 'propose'){
                        const propose_actions = await eos_api.deserializeActions(action.data.trx.actions);
                        const msig_actions = JSON.stringify(propose_actions, '', 4);
                        messages.push(`Created an msig to call\n<pre>${msig_actions}</pre>\n\nhttps://wax.bloks.io/transaction/${this.actions[a].txid}`);
                    }
                    break;
                default:
                    const action_data = await eos_api.deserializeActions([this.actions[a].action.act]);
                    if (action_data[0].account === 'eosio.token' && this.actions[a].actor === 'eosio'){
                        continue;
                    }
                    else {
                        const action_data_str = JSON.stringify(action_data, '', 4);
                        let str = `${this.actions[a].actor} called action ${this.actions[a].action.act.account}::${this.actions[a].action.act.name}`;
                        str += `\n\n<pre>${action_data_str}</pre>\n\nhttps://wax.bloks.io/transaction/${this.actions[a].txid}`
                        messages.push(str);
                    }
                    break;
            }
        }

        this.queue = this.queue.concat(messages);

        if (this.queue.length){
            this.sendMessage(this.queue.shift(), telegram_channel);
            await sleep(500);
            this.sendMessage(this.queue.shift(), telegram_channel);
            await sleep(500);
            this.sendMessage(this.queue.shift(), telegram_channel);
            await sleep(500);
            this.sendMessage(this.queue.shift(), telegram_channel);
            await sleep(500);
            this.sendMessage(this.queue.shift(), telegram_channel);
            await sleep(500);
            this.sendMessage(this.queue.shift(), telegram_channel);
            await sleep(500);
            this.sendMessage(this.queue.shift(), telegram_channel);
            console.log(`${this.queue.length} messages in the queue`);
        }

        this.actions = [];
    }

    async sendMessage(msg, channel){
        // console.log('Sending telegram message', msg);
        const url = `https://api.telegram.org/bot${telegram_api_key}/sendMessage`;
        const msg_obj = {
            chat_id: `@${channel}`,
            text: msg,
            parse_mode: 'html',
            disable_web_page_preview: true
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
        return resp_json
    }

    async queueTrace(block_num, traces, block_timestamp) {

        for (const trace of traces) {
            switch (trace[0]) {
                case 'transaction_trace_v0':
                    const trx = trace[1];
                    // console.log(trx)
                    for (let action of trx.action_traces) {
                        //console.log(action)
                        switch (action[0]) {
                            case 'action_trace_v0':
                                // console.log(action[1].act.authorization);
                                action[1].act.authorization.forEach(auth => {
                                    if (wax_accounts.includes(auth.actor) && !ignored_actions.includes(action[1].act.name)){
                                        // console.log(`${auth.actor} did something!`)
                                        this.actions.push({
                                            txid: trx.id,
                                            actor: auth.actor,
                                            action: action[1]
                                        });
                                    }
                                });
                                if (action[1].act.name == 'undelegatebw'){
                                    // console.log(`Undelegate`, action[1].act);
                                    const undelegate_actions = await eos_api.deserializeActions([action[1].act]);
                                    // console.log(undelegate_actions[0]);
                                    const [net_qty] = undelegate_actions[0].data.unstake_net_quantity.split(' ');
                                    const [cpu_qty] = undelegate_actions[0].data.unstake_cpu_quantity.split(' ');
                                    // console.log(undelegate_actions[0].data)
                                    const total = parseInt(net_qty) + parseInt(cpu_qty);
                                    // console.log(`Unstake ${total}`);
                                    if (total > 100000){
                                        this.actions.push({
                                            txid: trx.id,
                                            actor: action[1].act.authorization[0].actor,
                                            action: action[1]
                                        });
                                    }
                                }
                                break;
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
        start_block = info.last_irreversible_block_num;
    }

    start(start_block);

}

run();
