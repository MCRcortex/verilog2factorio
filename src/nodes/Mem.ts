import { logger } from "../logger.js";
import { Mem } from "../yosys.js";

import { ComparatorString, Decider } from "../entities/Decider.js";
import { Color, Endpoint, Entity, makeConnection, signalC, signalV } from "../entities/Entity.js";

import { Input } from "./Input.js";
import { createTransformer, mergeFunc, Node, nodeFunc } from "./Node.js";

function arraySame<T>(str: ArrayLike<T>, expected: T) {
    for (let i = 0; i < str.length; i++) {
        if (str[i] !== expected) return false;
    }

    return true;
}

export class MemNode extends Node {
    data: Mem;

    outputSegments: MemRead[] = [];
    entities: Entity[] = [];

    constructor(item: Mem) {
        super([]);
        this.data = item;

        const params = item.parameters;
        debugger;

        logger.assert(params.ABITS <= 32, "too many address bits");
        logger.assert(params.WIDTH <= 32, "cannot store > 32 bit numbers");
        logger.assert(arraySame(params.INIT, "x"), "memory initialization not implemented");

        logger.assert(params.RD_WIDE_CONTINUATION == 0);
        logger.assert(params.RD_CLK_ENABLE == 0);
        logger.assert(params.RD_CLK_POLARITY == 0);
        logger.assert(params.RD_TRANSPARENCY_MASK == 0);
        logger.assert(params.RD_COLLISION_X_MASK == 0);
        logger.assert(params.RD_CE_OVER_SRST == 0);
        logger.assert(arraySame(params.RD_INIT_VALUE, "x"));
        logger.assert(arraySame(params.RD_ARST_VALUE, "x"));
        logger.assert(arraySame(params.RD_SRST_VALUE, "x"));

        logger.assert(params.WR_PORTS == 1, "only one write allowed");
        logger.assert(params.WR_WIDE_CONTINUATION == 0);
        logger.assert(params.WR_CLK_ENABLE == 1, "wr_clk has to be set");
        logger.assert(params.WR_CLK_POLARITY == 1, "invert wr_clk polarity");
        logger.assert(params.WR_PRIORITY_MASK == 0);

        logger.assert(arraySame(item.connections.RD_CLK, "x"));
        logger.assert(arraySame(item.connections.RD_EN, "1"));
        logger.assert(arraySame(item.connections.RD_ARST, "0"));
        logger.assert(arraySame(item.connections.RD_SRST, "0"));

        logger.assert(arraySame(item.connections.WR_EN, item.connections.WR_EN[0]));

        let width = this.data.parameters.WIDTH;

        for (let i = 0; i < this.data.parameters.RD_PORTS; i++) {
            let bits = item.connections.RD_DATA.slice(i * width, (i + 1) * width);

            this.outputSegments.push(new MemRead(bits));
        }
    }

    _connect(getInputNode: nodeFunc, getMergeEls: mergeFunc): Endpoint {
        const WR_ADDR = getInputNode(this.data.connections.WR_ADDR);
        const WR_DATA = getInputNode(this.data.connections.WR_DATA);
        const WR_EN = getInputNode([this.data.connections.WR_EN[0]]);
        const WR_CLK = getInputNode(this.data.connections.WR_CLK);

        if (!(WR_CLK instanceof Input)) {
            // need an edge detector
            throw new Error("Not implemented");
        }

        const SIZE = this.data.parameters.SIZE;
        const RD_PORTS = this.data.parameters.RD_PORTS;
        const OFFSET = this.data.parameters.OFFSET;
        const ABITS = this.data.parameters.ABITS;

        let trans = new Decider({
            first_signal: signalV,
            constant: 2,
            comparator: ComparatorString.EQ,
            copy_count_from_input: false,
            output_signal: signalC
        });
        this.entities.push(trans);

        makeConnection(Color.Red, WR_CLK.output(), trans.input);
        makeConnection(Color.Green, WR_EN.output(), trans.input);

        let dffOuts = [];
        // create all dffs and write inputs
        for (let i = 0; i < SIZE; i++) {
            let writeEq = new Decider({
                first_signal: signalV,
                constant: i + OFFSET,
                comparator: ComparatorString.EQ,
                copy_count_from_input: true,
                output_signal: signalC,
            });
            makeConnection(Color.Red, WR_ADDR.output(), writeEq.input);
            makeConnection(Color.Green, trans.output, writeEq.input);

            let decider1 = new Decider({
                first_signal: signalC,
                constant: 1,
                comparator: ComparatorString.EQ,
                copy_count_from_input: true,
                output_signal: signalV
            }); // if c == 1 output a
            let decider2 = new Decider({
                first_signal: signalC,
                constant: 0,
                comparator: ComparatorString.EQ,
                copy_count_from_input: true,
                output_signal: signalV
            }); // if c == 0 output b

            this.entities.push(writeEq, decider1, decider2);

            makeConnection(Color.Red, WR_DATA.output(), decider1.input);

            makeConnection(Color.Green, writeEq.output, decider1.input, decider2.input);
            makeConnection(Color.Green, decider1.output, decider2.output);
            makeConnection(Color.Red, decider2.output, decider2.input, decider1.output);

            dffOuts.push(decider1);
        }

        // create read outputs
        for (let i = 0; i < RD_PORTS; i++) {
            let RD_ADDR = getInputNode(this.data.connections.RD_ADDR.slice(i * ABITS, (i + 1) * ABITS));

            let addrTrans = createTransformer(RD_ADDR.output());
            this.entities.push(addrTrans);

            let last;
            for (let j = 0; j < SIZE; j++) {
                let readEq = new Decider({
                    first_signal: signalC,
                    constant: j + OFFSET,
                    comparator: ComparatorString.EQ,
                    copy_count_from_input: true,
                    output_signal: signalV
                });
                this.entities.push(readEq);

                makeConnection(Color.Green, dffOuts[j].output, readEq.input);
                makeConnection(Color.Red, addrTrans.output, readEq.input);

                if (last) makeConnection(Color.Both, last.output, readEq.output);
                last = readEq;
            }

            this.outputSegments[i].endPoint = last.output;
        }

        return null;
    }
    combs(): Entity[] {
        return this.entities;
    }
    override output(): Endpoint {
        throw new Error("Method not allowed.");
    }
}

class MemRead extends Node {
    endPoint: Endpoint;

    constructor(bits: number[]) {
        super(bits);
    }

    _connect(getInputNode: nodeFunc, getMergeEls: mergeFunc): Endpoint {
        return this.endPoint;
    }

    combs(): Entity[] { return []; }
}
