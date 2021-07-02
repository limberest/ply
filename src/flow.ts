import * as minimatch from 'minimatch';
import * as flowbee from 'flowbee';
import { Logger, LogLevel } from './logger';
import { RunOptions } from './options';
import { Runtime } from './runtime';
import { PlyStep } from './step';
import { Suite } from './suite';
import { Request } from './request';
import * as util from './util';
import { Step } from 'flowbee';
import { Result } from './result';
import { RUN_ID } from './names';

export interface Flow {
    flow: flowbee.Flow;
    instance: flowbee.FlowInstance;
}
export interface Subflow {
    subflow: flowbee.Subflow;
    instance: flowbee.SubflowInstance;
}

export class FlowResults {
    results: Result[] = [];

    constructor(readonly name: string) { }

    get latest(): Result {
        if (this.results.length > 0) {
            return this.results[this.results.length - 1];
        } else {
            return { name: this.name, status: 'Pending', message: '' };
        }
    }

    latestBad(): boolean {
        return this.latest.status === 'Failed' || this.latest.status === 'Errored';
    }

    get overall(): Result {
        let otherThanSubmitted = false;
        for (const result of this.results) {
            if (result.status === 'Failed' || result.status === 'Errored') {
                return result;
            } else if (result.status !== 'Submitted') {
                otherThanSubmitted = true;
            }
        }
        return { name: this.name, status: otherThanSubmitted ? 'Passed' : 'Submitted', message: '' };
    }
}

export class PlyFlow implements Flow {
    readonly name: string;
    readonly type = 'flow';
    start = 0;
    end?: number | undefined;
    readonly instance: flowbee.FlowInstance;
    readonly results: FlowResults;

    private _onFlow = new flowbee.TypedEvent<flowbee.FlowEvent>();
    onFlow(listener: flowbee.Listener<flowbee.FlowEvent>) {
        this._onFlow.on(listener);
    }

    constructor(
        readonly flow: flowbee.Flow,
        readonly requestSuite: Suite<Request>,
        private readonly logger: Logger
    ) {
        this.name = flowbee.getFlowName(flow);
        const id = util.genId();
        this.instance = {
            id,
            runId: id,
            flowPath: this.flow.path,
            status: 'Pending'
        };
        this.results = new FlowResults(this.name);
    }

    /**
     * Run a ply flow.
     */
    async run(runtime: Runtime, values: object, runOptions?: RunOptions): Promise<Result> {

        (values as any)[RUN_ID] = this.instance.runId || util.genId();

        if (this.flow.attributes?.values) {
            const rows = JSON.parse(this.flow.attributes?.values);
            for (const row of rows) {
                (values as any)[row[0]] = row[1];
            }
        }
        // run values override even flow-configured vals
        if (runOptions?.values) {
            values = { ...values, ...runOptions.values };
        }

        if (this.flow.attributes?.bail === 'true') {
            runtime.options.bail = true;
        }

        runtime.results.actual.write('');
        const expectedExists = await this.requestSuite.runtime.results.expectedExists();
        if (!expectedExists && runOptions?.submitIfExpectedMissing) {
            runOptions.submit = true;
        }
        if (runOptions?.createExpected || (!expectedExists && runOptions?.createExpectedIfMissing)) {
            this.logger.info(`Creating expected result: ${runtime.results.expected}`);
            runtime.results.expected.write('');
            runOptions.createExpected = true;
        }

        const runId = this.logger.level === LogLevel.debug ? ` (${this.instance.runId})` : '';
        this.logger.info(`Running flow '${this.name}'${runId}`);
        this.instance.status = 'In Progress';
        this.instance.values = values as flowbee.Values;
        this.instance.start = new Date();
        this.emit('start', 'flow', this.instance);

        await this.runSubflows(this.getSubflows('Before'), runtime, values, runOptions);
        if (this.results.latestBad() && runtime.options.bail) {
            return this.endFlow();
        }

        const startStep = this.flow.steps?.find(s => s.path === 'start');
        if (!startStep) {
            throw new Error(`Cannot find start step in flow: ${this.flow.path}`);
        }

        await this.exec(startStep, runtime, values, runOptions);
        if (this.results.latestBad() && runtime.options.bail) {
            return this.endFlow();
        }

        await this.runSubflows(this.getSubflows('After'), runtime, values, runOptions);

        return this.endFlow();
    }

    private endFlow(): Result {
        this.instance.end = new Date();
        if (this.instance.status === 'Errored' || this.instance.status === 'Failed') {
            this.emit('error', 'flow', this.instance);
        } else {
            this.instance.status = 'Completed';
            this.emit('finish', 'flow', this.instance);
        }
        return this.results.overall;
    }

    /**
     * Executes a step within a flow and recursively executes the following step(s).
     */
    async exec(step: flowbee.Step, runtime: Runtime, values: object, runOptions?: RunOptions, subflow?: Subflow) {

        await this.runSubflows(this.getSubflows('Before', step), runtime, values, runOptions);
        if (this.results.latestBad() && runtime.options.bail) {
            return;
        }

        const plyStep = new PlyStep(step, this.requestSuite, this.logger, this.flow.path, this.instance.id, subflow?.subflow);
        if (subflow) {
            if (!subflow.instance.stepInstances) {
                subflow.instance.stepInstances = [];
            }
            subflow.instance.stepInstances.push(plyStep.instance);
        } else {
            if (!this.instance.stepInstances) {
                this.instance.stepInstances = [];
            }
            this.instance.stepInstances.push(plyStep.instance);
        }
        this.emit('start', 'step', plyStep.instance);

        this.logger.info('Executing step', plyStep.name);
        this.emit('exec', 'step', plyStep.instance);

        this.results.results.push(await plyStep.run(runtime, values, runOptions));

        if (this.results.latestBad()) {
            this.instance.status = plyStep.instance.status;
            if (subflow) subflow.instance.status = plyStep.instance.status;
            this.emit('error', 'step', plyStep.instance);
            if (runtime.options.bail) {
                return;
            }
        } else {
            this.emit('finish', 'step', plyStep.instance);
        }

        await this.runSubflows(this.getSubflows('After', step), runtime, values, runOptions);
        if (this.results.latestBad() && runtime.options.bail) {
            return;
        }

        const outSteps: flowbee.Step[] = [];
        if (step.links) {
            for (const link of step.links) {
                const result = plyStep.instance.result?.trim();
                if ((!result && !link.result) || (result === link.result)) {
                    let outStep: Step | undefined;
                    if (subflow) {
                        outStep = subflow.subflow.steps?.find(s => s.id === link.to);
                    } else {
                        outStep = this.flow.steps?.find(s => s.id === link.to);
                    }
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

        // steps can execute in parallel
        await Promise.all(outSteps.map(outStep => this.exec(outStep, runtime, values, runOptions, subflow)));
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
                    id: Date.now().toString(16),
                    flowInstanceId,
                    subflowId: subflow.id,
                    runId: Date.now().toString(16),
                    flowPath: this.flow.path,
                    status: 'Pending'
                }
            };
        });
    }

    async runSubflows(subflows: Subflow[], runtime: Runtime, values: object, runOptions?: RunOptions) {
        for (const subflow of subflows) {
            const startStep = subflow.subflow.steps?.find(s => s.path === 'start');
            if (!startStep) {
                throw new Error(`Cannot find start step in subflow: ${subflow.subflow.id}`);
            }
            subflow.instance.status = 'In Progress';
            subflow.instance.start = new Date();
            if (!this.instance.subflowInstances) {
                this.instance.subflowInstances = [];
            }
            this.instance.subflowInstances.push(subflow.instance);

            this.emit('start', 'subflow', subflow.instance);
            this.logger.info('Executing subflow', subflow.subflow.name);
            runtime.appendResult(`${subflow.subflow.name}:`, 0, runOptions?.createExpected, util.timestamp(subflow.instance.start));
            runtime.appendResult(`id: ${subflow.subflow.id}`, 1, runOptions?.createExpected);
            await this.exec(startStep, runtime, values, runOptions, subflow);
            subflow.instance.end = new Date();
            const elapsed = subflow.instance.end.getTime() - subflow.instance.start.getTime();
            if (this.results.latestBad()) {
                subflow.instance.status = this.results.latest.status === 'Errored' ? 'Errored' : 'Failed';
                runtime.appendResult(`status: ${subflow.instance.status}`, 1, runOptions?.createExpected, `${elapsed} ms`);
                this.emit('error', 'subflow', subflow.instance);
                if (runtime.options.bail) {
                    return;
                }
            } else {
                subflow.instance.status = 'Completed';
                runtime.appendResult(`status: ${subflow.instance.status}`, 1, runOptions?.createExpected, `${elapsed} ms`);
                this.emit('finish', 'subflow', subflow.instance);
            }
        }
    }

    flowEvent(
        eventType: flowbee.FlowEventType,
        elementType: flowbee.FlowElementType,
        instance: flowbee.FlowInstance | flowbee.SubflowInstance | flowbee.StepInstance
    ): flowbee.FlowEvent {
        return {
            eventType,
            elementType,
            flowPath: this.flow.path,
            flowInstanceId: this.instance.id,
            instance
        };
    }

    private emit(
        eventType: flowbee.FlowEventType,
        elementType: flowbee.FlowElementType,
        instance: flowbee.FlowInstance | flowbee.SubflowInstance | flowbee.StepInstance
    ) {
        this._onFlow.emit(this.flowEvent(eventType, elementType, instance));
    }
}