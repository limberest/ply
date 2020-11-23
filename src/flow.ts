import * as minimatch from 'minimatch';
import * as flowbee from 'flowbee';
import { Logger } from './logger';
import { RunOptions } from './options';
import { Result, ResultStatus } from './result';
import { Runtime } from './runtime';
import { PlyTest, Test } from './test';
import { PlyStep } from './step';
import { Suite } from './suite';
import { Request } from './request';

export interface Flow extends Test {
    flow: flowbee.Flow;
    instance: flowbee.FlowInstance;
}
export interface Subflow {
    subflow: flowbee.Subflow;
    instance: flowbee.SubflowInstance;
}

export class PlyFlow implements Flow, PlyTest {
    readonly name: string;
    readonly type = 'flow';
    start = 0;
    end?: number | undefined;
    readonly instance: flowbee.FlowInstance;

    private _onFlow = new flowbee.TypedEvent<flowbee.FlowEvent>();
    onFlow(listener: flowbee.Listener<flowbee.FlowEvent>) {
        this._onFlow.on(listener);
    }

    private _onSubflow = new flowbee.TypedEvent<flowbee.SubflowEvent>();
    onSubflow(listener: flowbee.Listener<flowbee.SubflowEvent>) {
        this._onSubflow.on(listener);
    }

    private _onStep = new flowbee.TypedEvent<flowbee.StepEvent>();
    onStep(listener: flowbee.Listener<flowbee.StepEvent>) {
        this._onStep.on(listener);
    }

    constructor(
        readonly flow: flowbee.Flow,
        private readonly requestSuite: Suite<Request>,
        private readonly logger: Logger
    ) {
        this.name = flowbee.getFlowName(flow);
        if (this.name.endsWith('.ply')) {
            this.name = this.name.substring(0, this.name.length - 4);
        }
        this.instance = {
            id: '',
            runId: Date.now().toString(16),
            flowPath: this.flow.path,
            status: 'Pending'
        };
    }

    async run(runtime: Runtime, runOptions?: RunOptions): Promise<Result> {
        this.logger.info(`Running '${this.name}'`);

        if (this.flow.attributes?.values) {
            const rows = JSON.parse(this.flow.attributes?.values);
            for (const row of rows) {
                (runtime.values as any)[row[0]] = row[1];
            }
        }

        await this.runSubflows(this.getSubflows('Before'), runtime, runOptions);

        const startStep = this.flow.steps?.find(s => s.path === 'start');
        if (!startStep) {
            throw new Error(`Cannot find start step in flow: ${this.flow.path}`);
        }
        this.instance.status = 'In Progress';
        this.instance.values = runtime.values as flowbee.Values;
        this.instance.start = new Date();

        this._onFlow.emit({ type: 'start', instance: this.instance });
        await this.exec(startStep, runtime, runOptions);

        // compiler doesn't know that this.instance.status may have changed
        if ((this.instance.status as any) === 'Errored' && runtime.options.bail) {
            return { name: this.name, status: this.mapInstanceStatus(), message: '' }; // TODO message?
        }
        await this.runSubflows(this.getSubflows('After'), runtime, runOptions);

        this.instance.end = new Date();

        // compiler doesn't know that this.instance.status may have changed
        if ((this.instance.status as any) === 'Errored') {
            this._onFlow.emit({ type: 'error', instance: this.instance });
        } else {
            this.instance.status = 'Completed';
            this._onFlow.emit({ type: 'finish', instance: this.instance });
        }

        return { name: this.name, status: this.mapInstanceStatus(), message: '' }; // TODO message?
    }

    /**
     * Map instance status to result status
     */
    private mapInstanceStatus(): ResultStatus {
        if (this.instance.status === 'Pending' || this.instance.status === 'In Progress' || this.instance.status === 'Waiting') {
            return 'Pending';
        } else if (this.instance.status === 'Completed' || this.instance.status === 'Canceled') {
            return 'Passed';
        } else {
            return this.instance.status;
        }
    }

    async exec(step: flowbee.Step, runtime: Runtime, runOptions?: RunOptions, subflow?: Subflow): Promise<void> {

        await this.runSubflows(this.getSubflows('Before', step), runtime, runOptions);

        const plyStep = new PlyStep(step, this.requestSuite, this.logger, this.instance.id);
        this._onStep.emit({ type: 'start', instance: plyStep.instance });

        if (!this.instance.stepInstances) {
            this.instance.stepInstances = [];
        }

        this.instance.stepInstances.push(plyStep.instance);

        this.logger.info('Executing step', plyStep.name);
        this._onStep.emit({ type: 'exec', instance: plyStep.instance });
        await plyStep.exec(runtime, runOptions);
        if (plyStep.instance.status === 'Failed' || plyStep.instance.status === 'Errored') {
            this.instance.status = 'Errored';
            if (subflow) subflow.instance.status = 'Errored';
            this._onStep.emit({ type: 'error', instance: plyStep.instance });
        } else {
            this._onStep.emit({ type: 'finish', instance: plyStep.instance });
        }
        if (plyStep.instance.status !== 'Completed' && runtime.options.bail) {
            return;
        }

        await this.runSubflows(this.getSubflows('After', step), runtime, runOptions);

        const outSteps: flowbee.Step[] = [];
        if (step.links) {
            for (const link of step.links) {
                const result = plyStep.instance.result?.trim();
                if ((!result && !link.result) || (result === link.result)) {
                    let outStep = this.flow.steps?.find(s => s.id === link.to);
                    if (!outStep && this.flow.subflows) {
                        for (let i = 0; i < this.flow.subflows.length; i++) {
                            const subflow = this.flow.subflows[i];
                            outStep = subflow.steps?.find(s => s.id === link.to);
                            if (outStep) break;
                        }
                    }
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
        if (outSteps.length === 0 && step.path !== 'stop') {
            throw new Error(`No outbound link from step ${step.id} matches result: ${plyStep.instance.result}`);
        }

        await Promise.all(outSteps.map(outStep => this.exec(outStep, runtime, runOptions)));
    }

    getSubflows(type: 'Before' | 'After', step?: flowbee.Step): Subflow[] {
        const subflows = this.flow.subflows?.filter(sub => {
            if (sub.attributes?.when === type) {
                const steps = sub.attributes?.steps;
                if (step) {
                    return steps ? minimatch(step.name, steps) : false;
                } else {
                    return !steps;
                }
            }
        }) || [];
        const flowInstanceId = this.instance.id;
        return subflows.map(subflow => {
            return {
                subflow,
                instance: {
                    id: '',
                    flowInstanceId,
                    subflowId: subflow.id,
                    runId: Date.now().toString(16),
                    flowPath: this.flow.path,
                    status: 'Pending'
                }
            };
        });
    }

    async runSubflows(subflows: Subflow[], runtime: Runtime, runOptions?: RunOptions) {
        for (const subflow of subflows) {
            const startStep = subflow.subflow.steps?.find(s => s.path === 'start');
            if (!startStep) {
                throw new Error(`Cannot find start step in subflow: ${subflow.subflow.id}`);
            }
            subflow.instance.status = 'In Progress';
            subflow.instance.start = new Date();
            this._onFlow.emit({ type: 'start', instance: this.instance });
            this.logger.info('Executing subflow', subflow.subflow.name);
            await this.exec(startStep, runtime, runOptions, subflow);
            subflow.instance.end = new Date();
            // compiler doesn't know that this.instance.status may have changed
            if ((subflow.instance.status as any) === 'Errored') {
                this._onSubflow.emit({ type: 'error', instance: subflow.instance });
            } else {
                subflow.instance.status = 'Completed';
                this._onSubflow.emit({ type: 'finish', instance: subflow.instance });
            }
        }
    }
}