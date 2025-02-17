import { ConnectionPoint, EntityBase, SignalID } from "../blueprint.js";
import { logger } from "../logger.js";

import { Entity, signalV, Endpoint } from "./Entity.js";

export interface ConstantControlBehavior {
    signal: SignalID;
    count: number;
    index: number;
}

export interface ConstantCombinator extends EntityBase {
    name: "constant-combinator",
    control_behavior: {
        is_on?: boolean;
        filters: ConstantControlBehavior[];
    }
    connections: {
        "1": ConnectionPoint
    };
}

export class Constant extends Entity {
    params: ConstantControlBehavior[];
    isOn = true;

    constructor(...param: ConstantControlBehavior[]) {
        super(1, 1);
        this.params = param;

        this.input = this.output = new Endpoint(this, 1, ...this.params.map(x => x.signal));
    }

    toObj(): ConstantCombinator {
        logger.assert(this.input.redP.size != 0 || this.input.greenP.size != 0, "Unconnected Constant")

        return {
            entity_number: this.id,
            name: "constant-combinator",
            position: { x: this.x, y: this.y },
            direction: this.dir,
            control_behavior: {
                is_on: this.isOn,
                filters: this.params
            },
            connections: {
                "1": this.input.convert()
            }
        };
    }

    getValue(s: SignalID) {
        for (const el of this.params) {
            if (el.signal == s) return el.count;
        }
    }

    static simple(value: number) {
        return new Constant({
            count: value,
            index: 1,
            signal: signalV
        });
    }
}
