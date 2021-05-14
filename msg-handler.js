
const fs = require('fs');
const FormData = require('form-data');
const FileType = require('file-type');
const md5 = require('md5');
const bs58 = require('bs58');
const crypto = require('crypto');
const { deserialize, ObjectSchema } = require("atomicassets");

(() => {
    class MsgHandler {
        constructor(config) {
            this.config = config;
            this.schema_cache = {};
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
            console.log('Sending telegram message', channel, msg, photo, retries);
            const url = `https://api.telegram.org/bot${this.config.telegram_api_key}/sendPhoto`;

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
            if (retries <= 1){
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

                // console.log(`uploading....`, form.getHeaders());

                res = await fetch(url, {
                    method: 'POST',
                    headers: form.getHeaders(),
                    body: form
                });
            }
            else {
                console.log(`Sending as url, not photo`)
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
            // console.log(resp_json);

            if (!resp_json.ok){
                console.log(`Sending failed, try again ${retries}`, resp_json);
                setTimeout(() => {
                    this.sendTelegram(msg, photo, channel, ++retries);
                }, 1000);
            }
            // process.exit(0)

            return resp_json
        }

        getString(drop_data){
            let str = '';
            console.log(drop_data);

            str += `<b>Name</b>: ${drop_data.assets_to_mint[0].immutable_data.name}\n`;
            str += `<b>Collection</b>: ${drop_data.collection_name}\n`;
            str += `<b>Price</b>: ${drop_data.listing_price}\n`;
            if (drop_data.assets_to_mint[0].immutable_data.description){
                str += `<b>Description</b>: ${drop_data.assets_to_mint[0].immutable_data.description}\n`;
            }
            if (drop_data.start_time > 0){
                const date = new Date(drop_data.start_time * 1000);
                str += `<b>Start Time</b>: ${date}`;
            }
            str += `\n<b>Already Minted</b>: ${drop_data.assets_to_mint[0].issued_supply}`
            str += `\n<b>Drop ID</b>: ${drop_data.drop_id}`
            str += `\n<a href="https://wax.atomichub.io/drops/${drop_data.drop_id}">Get Drop</a>`

            return str;
        }

        escapeTelegram(str){
            return str.replace(/\!/g, '\\!').replace(/\./g, '\\.').replace(/\-/g, '\\-').replace(/\#/g, '\\#');
        }

        async getSchema(collection_name, schema_name) {
            if (typeof this.schema_cache[`${schema_name}:${collection_name}`] !== 'undefined'){
                return this.schema_cache[`${schema_name}:${collection_name}`];
            }

            const schema_res = await rpc.get_table_rows({
                code: 'atomicassets',
                scope: collection_name,
                table: 'schemas',
                lower_bound: schema_name,
                upper_bound: schema_name,
                limit: 1
            });

            if (!schema_res.rows.length){
                console.error(`Could not find schema with name ${schema_name} in collection`);
                return null;
            }

            const schema = ObjectSchema(schema_res.rows[0].format);

            this.schema_cache[`${schema_name}:${collection_name}`] = schema;

            return schema;
        }

        async getTemplateData(collection_name, template_id){
            const res = await rpc.get_table_rows({
                code: 'atomicassets',
                scope: collection_name,
                table: 'templates',
                lower_bound: template_id,
                upper_bound: template_id
            });

            let template_data = null;
            if (res.rows.length){
                template_data = res.rows[0];
                const schema = await this.getSchema(collection_name, res.rows[0].schema_name);
                // console.log(schema);
                template_data.immutable_data = await deserialize(res.rows[0].immutable_serialized_data, schema);
            }

            return template_data;
        }

        async processMessage(drop_data){
            for (let d = 0; d < drop_data.assets_to_mint.length; d++){
                const template_data = await this.getTemplateData(drop_data.collection_name, drop_data.assets_to_mint[d].template_id);
                // console.log(template_data);
                // process.exit(0);
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
                if (delay_ms > 0){
                    setTimeout(() => {
                        this.sendTelegram(`<b>REMINDER - SALE STARTS IN 5 MINS</b>\n\n${str}`, img, this.config.telegram_channel);
                    }, delay_ms);
                }
            }

            this.sendTelegram(str, img, this.config.telegram_channel);
        }
    }



    const config = JSON.parse(process.argv[2]);

    const mh = new MsgHandler(config);

    const {Api, JsonRpc, Serialize} = require('eosjs');
    const { JsSignatureProvider } = require('eosjs/dist/eosjs-jssig');
    const fetch = require('node-fetch');
    const { TextDecoder, TextEncoder } = require('text-encoding');

    // const signatureProvider = new JsSignatureProvider([config.eos.privateKey]);
    const rpc = new JsonRpc(config.eos.endpoint, {fetch});
    const eos_api = new Api({ rpc, signatureProvider: null, textDecoder: new TextDecoder(), textEncoder: new TextEncoder() });

    process.on('message', async (msg) => {
        console.log('CHILD got message:', msg);

        const data = JSON.parse(msg);

        // console.log(data);
        mh.processMessage(data);
    });
})()
