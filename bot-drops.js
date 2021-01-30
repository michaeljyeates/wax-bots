#!/usr/bin/env node

const StateReceiver = require('@eosdacio/eosio-statereceiver');
const {Api, JsonRpc, Serialize} = require('eosjs');
const Int64 = require('int64-buffer').Int64BE;
const fetch = require('node-fetch');
const { ExplorerApi } = require('atomicassets');
const fs = require('fs');
const FormData = require('form-data');
const FileType = require('file-type');
const md5 = require('md5');
const bs58 = require('bs58');
const crypto = require('crypto');

const telegram_api_key = require('./secret').telegram_api_key;
const telegram_channel = 'allnftdrops';
// const telegram_channel = 'gqjfgtyu';
const telegram_bot = 'packrips_bot';

const atomicassets_account = 'atomicassets';
const atomicdrops_contract = 'atomicdropsx';
const endpoint = 'https://wax.eosdac.io';
const atomic_endpoint = 'https://wax.api.atomicassets.io';
const eos_rpc = new JsonRpc(endpoint, {fetch});
const eos_api = new Api({ rpc: eos_rpc, signatureProvider:null, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });
const atomic = new ExplorerApi(atomic_endpoint, atomicassets_account, { fetch, rateLimit: 4 });


class TraceHandler {
    constructor({config}) {
        this.config = config;
    }

    validate_file (url, read_stream) {
        // Verify file matches ipfs hash
        const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        const hash_res = (new RegExp(`/(Q[${alphabet}]*)`)).exec(url);
        if (hash_res && hash_res[1]){
            const hash = hash_res[1];
            console.log(`Verifying hash ${hash}`);
            const decoded = bs58.decode(hash);
            console.log(decoded);
            const algo = decoded[0].toString(16);
            const len = decoded[1];
            const data = decoded.slice(2);
            console.log(data.toString('hex'));
            console.log(`hash algo = ${algo}`);

            if (algo === '12'){ // sha2-256
                var hash_obj = crypto.createHash('sha256');
                hash_obj.setEncoding('hex');

                read_stream.on('end', function() {
                    hash_obj.end();
                    console.log(hash_obj.read()); // the desired sha1sum
                    process.exit(0)
                });

                // read all file and pipe it (write it) to the hash object
                read_stream.pipe(hash_obj);
            }
            else {
                console.log(`Unknown hash algorithm ${algo}`);
            }
        }
    }

    async sendTelegram (msg, photo, channel, retries = 0) {
        if (retries >= 5){
            console.error(`Too many retries`);
            return;
        }
        console.log('Sending telegram message', channel, msg, photo);
        const url = `https://api.telegram.org/bot${telegram_api_key}/sendPhoto`;

        // download the file and upload to avoid filesize limits
        // check if we have an extension
        const last_dot = photo.lastIndexOf('.');
        let extension = 'unknown';
        if (last_dot > -1){
            const test_extension = photo.substr(last_dot + 1);
            if (test_extension.length < 5){
                extension = test_extension;
            }
            // console.log(test_extension);
        }

        let res;


        // save and upload any unknown extensions, or if it failed first time
        if (extension == 'unknown' || retries > 1){
            const md5_url = md5(photo);
            const photo_path = `./photos/${md5_url}`;
            console.log(`Saving photo ${photo_path}`);
            let stats = {size: 0};
            if (fs.existsSync(photo_path)){
                stats = fs.statSync(photo_path);
            }
            if (!fs.existsSync(photo_path) || stats['size'] === 0){
                const photo_res = await fetch(photo);
                const dest = fs.createWriteStream(photo_path);
                await photo_res.body.pipe(dest);
            }

            if (!fs.existsSync(photo_path)){
                console.log(`Failed to write file, trying again`);

                setTimeout(() => {
                    this.sendTelegram(msg, photo, channel, ++retries);
                }, 1000);

                return;
            }

            const readStream = await fs.createReadStream(photo_path);

            // console.log(`Validate ${photo_path}`);
            // this.validate_file(photo, readStream);

            const file_type = await FileType.fromFile(photo_path);
            const form = new FormData();
            form.append('chat_id', `@${channel}`);
            form.append('photo', readStream, {headers: `Content-Type: ${file_type.mime}`, filename: `${md5_url}.${file_type.ext}`});
            form.append('caption', msg);
            form.append('parse_mode', 'html');
            // console.log(form)

            /**/
            // console.log(JSON.stringify(msg_obj));
            // return;

            console.log(`uploading....`, form.getHeaders());

            res = await fetch(url, {
                method: 'POST',
                headers: form.getHeaders(),
                body: form
            });
        }
        else {
            // send photo as url
            const msg_obj = {
                chat_id: `@${channel}`,
                photo,
                caption: msg,
                parse_mode: 'html'
            }

            res = await fetch(url, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json'
                },
                body: JSON.stringify(msg_obj)
            });
        }

        const resp_json = await res.json()
        console.log(resp_json);
        // process.exit(0)

        return resp_json
    }

    getString(drop_data){
        let str = '';
        console.log(drop_data);

        str += `<b>Name</b>: ${drop_data.assets_to_mint[0].name}\n`;
        str += `<b>Collection</b>: ${drop_data.collection_name}\n`;
        str += `<b>Price</b>: ${drop_data.listing_price}\n`;
        if (drop_data.assets_to_mint[0].immutable_data.description){
            str += `<b>Description</b>: ${drop_data.assets_to_mint[0].immutable_data.description}\n`;
        }
        if (drop_data.start_time > 0){
            const date = new Date(drop_data.start_time * 1000);
            str += `<b>Start Time</b>: ${date}`;
        }
        str += `\n<a href="https://wax.atomichub.io/drops/${drop_data.drop_id}">Get Drop</a>`

        return str;
    }

    escapeTelegram(str){
        return str.replace(/\!/g, '\\!').replace(/\./g, '\\.').replace(/\-/g, '\\-').replace(/\#/g, '\\#');
    }

    async processMessage(drop_data){
        for (let d = 0; d < drop_data.assets_to_mint.length; d++){
            const template_data = await atomic.getTemplate(drop_data.collection_name, drop_data.assets_to_mint[d].template_id);
            drop_data.assets_to_mint[d] = template_data;
        }

        // console.log(drop_data.assets_to_mint[0].immutable_data);
        let img = drop_data.assets_to_mint[0].immutable_data.img;
        if (img && img.substr(0, 1) === 'Q'){
            img = `https://ipfs.io/ipfs/${img}`;
        }
        const str = this.getString(drop_data);

        if (drop_data.start_time > 0){
            const now = new Date().getTime();
            const delay_ms = (drop_data.start_time * 1000) - now - (60 * 5 * 1000);
            setTimeout(() => {
                this.sendTelegram(`<b>REMINDER - SALE STARTS IN 5 MINS</b>\n\n${str}`, img, telegram_channel);
            }, delay_ms);
        }

        this.sendTelegram(str, img, telegram_channel);
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
                                if (action[1].act.account === atomicdrops_contract && action[1].act.name == 'lognewdrop'){
                                    const action_deser = await eos_api.deserializeActions([action[1].act]);
                                    // console.log(action_deser[0].data);
                                    this.processMessage(action_deser[0].data);
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
        start_block = info.head_block_num;
    }

    start(start_block);
}

run();
