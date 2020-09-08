const StateReceiver = require('@eosdacio/eosio-statereceiver');

class TraceHandler {
    constructor({config, end_block}) {
        this.config = config;
        this.end_block = end_block;
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
                                console.log(action[1]);
                                break;
                        }
                    }
                    break;
            }
        }

        if (this.end_block === block_num){
            setTimeout(() => {
                finished = true;
            }, 10000);
        }
    }

    async processTrace(block_num, traces, block_timestamp) {
        // console.log(`Process block ${block_num}`)
        return this.queueTrace(block_num, traces, block_timestamp);
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
