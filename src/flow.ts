import * as flowbee from 'flowbee';
import { Logger } from './logger';
import { RunOptions } from './options';
import { Result } from './result';
import { Runtime } from './runtime';
import { PlyTest, Test } from './test';
import { PlyStep } from './step';
import { Suite } from './suite';
import { Request } from './request';

export interface Flow extends Test {
    flow: flowbee.Flow;
    instance: flowbee.FlowInstance;
}

export class PlyFlow implements Flow, PlyTest {
    readonly name: string;
    readonly type = 'flow';
    start = 0;
    end?: number | undefined;
    readonly instance: flowbee.FlowInstance;

    constructor(
        readonly flow: flowbee.Flow,
        readonly requestSuite: Suite<Request>,
        readonly logger: Logger
    ) {
        this.name = flow.path; // TODO trim?
        this.instance = {
            id: '',
            runId: Date.now().toString(16),
            flowPath: this.flow.path,
            status: 'Pending'
        };
    }

    async run(runtime: Runtime, runOptions?: RunOptions): Promise<Result> {
        this.logger.info(`Running '${this.name}'`);

        const startStep = this.flow.steps?.find(s => s.path === 'start');
        if (!startStep) {
            throw new Error(`Cannot find start step in flow: ${this.flow.path}`);
        }
        this.instance.status = 'In Progress';
        this.instance.values = runtime.values as flowbee.Values;
        this.instance.start = new Date();

        await this.exec(startStep, runtime, runOptions);

        this.instance.end = new Date();
        this.instance.status = 'Completed';

        return {
            name: this.name,
            status: 'Pending',
            message: ''
        };
    }

    async exec(step: flowbee.Step, runtime: Runtime, runOptions?: RunOptions): Promise<void> {

        this.logger.info('Executing step', step.path);

        const plyStep = new PlyStep(step, this.requestSuite, this.instance.id, this.logger);

        if (!this.instance.stepInstances) {
            this.instance.stepInstances = [];
        }

        this.instance.stepInstances.push(plyStep.instance);

        const res = await plyStep.exec(runtime, runOptions);

        plyStep.instance.end = new Date();
        plyStep.instance.status = 'Completed';
        if (typeof res === 'boolean' || typeof res === 'number' || res) {
            plyStep.instance.result = '' + res;
        }

        const outSteps: flowbee.Step[] = [];
        if (step.links) {
            for (const link of step.links) {
                // TODO: match event
                if (plyStep.instance.result === link.result) {
                    const outStep = this.flow.steps?.find(s => s.id === link.to);
                    if (!this.instance.linkInstances) {
                        this.instance.linkInstances = [];
                    }
                    this.instance.linkInstances.push({
                        id: Date.now().toString(16),
                        linkId: link.id,
                        flowInstanceId: this.instance.id,
                        status: 'Traversed'
                    });
                    if (!outStep) {
                        throw new Error(`No such step: ${link.to} (linked from ${link.id})`);
                    }
                    outSteps.push(outStep);
                }
            }
        }

        await Promise.all(outSteps.map(outStep => this.exec(outStep, runtime, runOptions)));
    }

}