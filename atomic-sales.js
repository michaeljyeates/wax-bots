const StateReceiver = require('@eosdacio/eosio-statereceiver');
const {Api, JsonRpc, Serialize} = require('eosjs');
const Int64 = require('int64-buffer').Int64BE;
const fetch = require('node-fetch');
const fs = require('fs');
const { RpcApi } = require("atomicassets");
const { TextDecoder, TextEncoder } = require('text-encoding');
const Discord = require('discord.js');
const FormData = require('form-data');
const FileType = require('file-type');
const md5 = require('md5');
const bs58 = require('bs58');
const crypto = require('crypto');

const secret = require('./secret');
const telegram_api_key = secret.telegram_api_key;
const telegram_channel = 'atomicsales';
// const telegram_channel = 'gqjfgtyu';
const telegram_bot = 'packrips_bot';
const specific_telegram = {
    kennbosakgif: 'kennbosakgif'
    // kennbosakgif: 'gqjfgtyu'
};
const specific_discord = {
    kennbosakgif: ['749369692862283811'],
    crptomonkeys: ['759708656392208415', '767855743981584395'],
    pepe: ['767855781030527026'],
    'alien.worlds': ['767855896306647073'],
    niftywizards: ['767855818241998858'],
    officialhero: ['767855840861618196'],
    kogsofficial: ['767855866979418112'],
    'gpk.topps': ['767855921401430057'],
    darkcountryh: ['767971691309170718'],
    atari: ['774015171030286346']
};
const general_discord = [
    '753197252889149441'
];

const twitter_api = secret.twitter;

const discord_bot_token = secret.discord.bot_token;
const discord_client = new Discord.Client();
discord_client.login(discord_bot_token);

const endpoint = 'https://wax.eosdac.io';
const atomic_endpoint = 'https://wax.api.atomicassets.io';
const aa_api = new RpcApi(endpoint, 'atomicassets', {fetch, rateLimit: 4});
const eos_rpc = new JsonRpc(endpoint, {fetch});
const eos_api = new Api({ rpc: eos_rpc, signatureProvider:null, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });


const { TraceHandler } = require(`./atomic-sales-tracehandler`);


class TelegramSender {

    constructor() {
        //setInterval(this.process_queue, 1000);
    }

    async process_queue () {
        console.log('process queue');
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

    async send_telegram (msg, photo, channel, retries = 0) {
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
                    this.send_telegram(msg, photo, channel, ++retries);
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

    async send_message (str, photo_url, collection) {
        // not ending the photo with image extension confuses telegram
        await this.send_telegram(str, photo_url, telegram_channel);

        if (typeof specific_telegram[collection] !== 'undefined'){
            await this.send_telegram(str, photo_url, specific_telegram[collection]);
        }

        if (typeof specific_discord[collection] !== 'undefined'){
            // console.log(`Sending discord`);
            for (let c = 0; c < specific_discord[collection].length; c++) {
                const channel_name = specific_discord[collection][c];
                const channel = discord_client.channels.cache.get(channel_name);
                if (channel){
                    const res = await channel.send(str.replace('<b>','').replace('</b>',''));
                    console.log('Discord response', res);
                }
                else {
                    // add bot link
                    // https://discord.com/api/oauth2/authorize?client_id=749361874532958338&permissions=0&scope=bot
                    console.error(`Channel ID ${channel_name} not found for ${collection}, bot probably not added`);
                }
            }
        }

        // send to all general discord channels
        general_discord.forEach(async cid => {
            const channel = discord_client.channels.cache.get(cid);
            if (channel){
                const res = await channel.send(str.replace('<b>','').replace('</b>',''));
                console.log('Discord response', res);
            }
            else {
                // add bot link
                // https://discord.com/api/oauth2/authorize?client_id=749361874532958338&permissions=0&scope=bot
                console.error(`Channel ID ${cid} not found, bot probably not added`);
            }
        });
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

    async sale (market, buyer, seller, quantity, asset) {

        // console.log(asset);

        let data = asset;
        if (market === 'atomic'){
            data = asset.data;
        }
        console.log(`Asset data `, data);

        let mint = '';
        if (data.sassets_id){
            mint = await this.getGPKMint(data.sassets_id);
            data.template_mint = '0';
        }
        else if (asset.template){
            let max_supply = asset.template.max_supply;
            if (asset.template.max_supply === 0){
                max_supply = '∞';
            }
            mint = `${asset.template_mint} / ${asset.template.issued_supply} (max ${max_supply})`;
        }

        let str = `Name : ${data.name}\n`;
        if (asset.collection){
            str += `Collection : ${asset.collection.collection_name}\n`;
        }
        if (asset.author){
            str += `Author : ${asset.author}\n`;
        }
        if (asset.category){
            str += `Category : ${asset.category}\n`;
        }
        str += `Buyer : ${buyer}\n`;
        str += `Seller : ${seller}\n`;
        if (mint){
            str += `Mint : ${mint}\n`;
        }
        else if (asset.mint){
            str += `Mint : ${asset.mint}\n`;
        }
        if (data.rarity){
            str += `Rarity : ${data.rarity}\n`;
        }
        if (data.shardid){
            str += `Shard Number : ${data.shardid}\n`;
        }
        if (data.variant){
            str += `Variant : ${data.variant}\n`;
        }
        if (data.cardid && data.quality){
            str += `Card : ${data.cardid}${data.quality}\n`;
        }
        else if (data.cardid){
            str += `Card : ${data.cardid}\n`;
        }
        if (data.foil){
            str += `Foil : YES\n`;
        }
        if (data.object){
            str += `Object : ${data.object}\n`;
        }
        if (data.border_color){
            str += `Border Color : ${data.border_color}\n`;
        }
        if (data.object_collection){
            str += `Object Collection : ${data.object_collection}\n`;
        }
        str += `Price : <b>${quantity}</b>\n\n`;


        if (market === 'myth'){
            if (asset.author === 'shatner'){
                market = 'shatner';
            }
            else if (asset.author === 'officialhero'){
                market = 'heroes';
            }
            else if (asset.author === 'gpk.topps'){
                market = 'gpk';
            }
            else {
                console.log(`Unknown author! ${asset.author}`);
            }
            str += `https://${market}.market/asset/${asset.asset_id}?referral=mryeateshere`
        }
        else if (market === 'atomic'){
            str += `https://wax.atomichub.io/explorer/asset/${asset.asset_id}`;
        }
        else if (market === 'simple'){
            str += `https://wax.simplemarket.io/products/asset/${asset.asset_id}?locale=en`;
        }
        else if (market === 'waxstash'){
            str += `https://waxstash.com`;
        }

        let photo_url;
        if (data.img.substr(0, 1) === 'Q'){ // Probably ipfs hash
            photo_url = `https://ipfs.io/ipfs/${data.img}`;
        }
        else if (data.img.substr(0, 4) === 'http') {
            photo_url = data.img;
        }
        else {
            console.error(`Could not find photo URL`);
            return;
        }

        let collection = 'unknown';
        if (market === 'atomic' && asset.collection){
            collection = asset.collection.collection_name;
        }
        else if (market === 'myth'){
            collection = asset.author;
        }

        await  this.send_message(str, photo_url, collection);
    };
}




const start = async (start_block) => {

    const config = require('./config');
    config.atomic_endpoint = 'https://wax.api.atomicassets.io';
    config.telegram_channel = telegram_channel;
    config.telegram_bot = telegram_bot;
    config.telegram_api_key = telegram_api_key;
    config.specific_telegram = specific_telegram;
    config.specific_discord = specific_discord;

    const trace_handler = new TraceHandler({config});
    trace_handler.add_sale_notify(new TelegramSender);

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


console.log(`Starting discord client...`);
discord_client.on("ready", () => {
    console.log('Discord client ready');
    run();
});
