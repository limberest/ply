import * as flowbee from 'flowbee';
import { PlyFlow } from './flow';
import { Logger, LogLevel } from './logger';
import { PlyOptions, RunOptions } from './options';
import { Retrieval } from './retrieval';
import { Runtime } from './runtime';
import { Result, ResultPaths } from './result';
import { Suite } from './suite';
import { PlyStep, Step } from './step';
import { Request } from './request';
import { Skip } from './skip';
import * as util from './util';
import * as yaml from './yaml';
import { Plyee } from './ply';

/**
 * Suite representing a ply flow.
 */
export class FlowSuite extends Suite<Step> {

    /**
     * @param plyFlow PlyFlow
     * @param path relative path from tests location (forward slashes)
     * @param runtime info
     * @param logger
     * @param start zero-based start line
     * @param end zero-based end line
     */
    constructor(
        readonly plyFlow: PlyFlow,
        readonly path: string,
        readonly runtime: Runtime,
        readonly logger: Logger,
        readonly start: number = 0,
        readonly end: number
    ) {
        super(plyFlow.name, 'flow', path, runtime, logger, start, end);
    }

    /**
     * Override to execute flow itself if all steps are specified
     * @param steps
     */
    async runTests(steps: Step[], values: object, runOptions?: RunOptions): Promise<Result[]> {
        if (runOptions && Object.keys(runOptions).length > 0) {
            this.log.debug('RunOptions', runOptions);
        }

        if (runOptions?.requireTsNode) {
            require('ts-node/register');
        }

        this.emitSuiteStarted();

        // runtime values are a deep copy of passed values
        const runValues = JSON.parse(JSON.stringify(values));
        this.runtime.responseHeaders = undefined;

        let results: Result[];
        if (this.isFlowSpec(steps)) {
            results = [await this.runFlow(runValues, runOptions)];
        } else {
            results = await this.runSteps(steps, runValues, runOptions);
        }

        this.emitSuiteFinished();

        return results;
    }

    private getStep(stepId: string): Step {
        const step = this.all().find(step => step.step.id === stepId);
        if (!step) throw new Error(`Step not found: ${stepId}`);
        return step;
    }

    async runFlow(values: object, runOptions?: RunOptions): Promise<Result> {
        this.plyFlow.onFlow(flowEvent => {
            if (flowEvent.eventType === 'exec') {
                // emit test event (not for request -- emitted in requestSuite)
                const stepInstance = flowEvent.instance as flowbee.StepInstance;
                const step = this.getStep(stepInstance.stepId);
                if (step.step.path !== 'request') {
                    this.emitTest(step);
                }
            } else {
                // exec not applicable for ply subscribers
                this.emitter?.emit('flow', flowEvent);
                if (flowEvent.elementType === 'step' && (flowEvent.eventType === 'finish' || flowEvent.eventType === 'error')) {
                    const stepInstance = flowEvent.instance as flowbee.StepInstance;
                    const step = this.getStep(stepInstance.stepId);
                    if (step.step.path !== 'request') {
                        if (flowEvent.eventType === 'error') {
                            this.emitter?.emit('outcome', {
                                plyee: new Plyee(this.runtime.options.testsLocation + '/' + this.path, step).path,
                                outcome: { status: 'Errored', message: stepInstance.message || ''}
                            });
                        } else if (flowEvent.eventType === 'finish') {
                            this.emitter?.emit('outcome', {
                                plyee: new Plyee(this.runtime.options.testsLocation + '/' + this.path, step).path,
                                outcome: { status: runOptions?.submit ? 'Submitted' : 'Passed', message: '' }
                            });
                        }
                    }
                }
            }
        });
        this.plyFlow.requestSuite.emitter = this.emitter;
        return await this.plyFlow.run(this.runtime, values, runOptions);
    }

    async runSteps(steps: Step[], values: object, runOptions?: RunOptions): Promise<Result[]> {

        // flow-configured values
        if (this.plyFlow.flow.attributes?.values) {
            const rows = JSON.parse(this.plyFlow.flow.attributes?.values);
            for (const row of rows) {
                (values as any)[row[0]] = row[1];
            }
        }

        // run values override even flow-configured vals
        if (runOptions?.values) {
            values = { ...values, ...runOptions.values };
        }

        const requestSuite = new Suite<Request>(
            this.plyFlow.name,
            'request',
            this.path,
            this.runtime,
            this.logger,
            0, 0
        );
        requestSuite.callingFlowPath = this.plyFlow.flow.path;
        requestSuite.emitter = this.emitter;
        this.runtime.results.actual.clear();
        const expectedExists = await this.runtime.results.expectedExists();
        if (!expectedExists && runOptions?.submitIfExpectedMissing) {
            runOptions.submit = true;
        }
        if (runOptions?.createExpected || (!expectedExists && runOptions?.createExpectedIfMissing)) {
            this.logger.info(`Creating expected result: ${this.runtime.results.expected}`);
            this.runtime.results.expected.write('');
            runOptions.createExpected = true;
        }

        const results: Result[] = [];
        // emit start event for synthetic flow
        this.emitter?.emit('flow', this.plyFlow.flowEvent('start', 'flow', this.plyFlow.instance));
        for (const step of steps) {
            this.emitTest(step);
            let subflow: flowbee.Subflow | undefined;
            const dot = step.name.indexOf('.');
            if (dot > 0) {
                const subflowId = step.name.substring(0, dot);
                subflow = this.plyFlow.flow.subflows?.find(sub => sub.id === subflowId);
            }
            const plyStep = new PlyStep(step.step, requestSuite, this.logger, this.plyFlow.flow.path, '', subflow);
            this.emitter?.emit('flow', this.plyFlow.flowEvent('start', 'step', plyStep.instance));
            const result = await plyStep.run(this.runtime, values, runOptions);
            if (result.status === 'Failed' || result.status === 'Errored') {
                this.emitter?.emit('flow', this.plyFlow.flowEvent('error', 'step', plyStep.instance));
            } else {
                this.emitter?.emit('flow', this.plyFlow.flowEvent('finish', 'step', plyStep.instance));
            }
            if (step.step.path !== 'request') {
                super.logOutcome(
                    step,
                    { status: result.status, message: result.message, start: plyStep.instance.start?.getTime() },
                    'Step'
                );
            }
            results.push(result);
        }
        return results;
    }

    /**
     * True if steps array is identical to flow steps.
     */
    private isFlowSpec(steps: Step[]): boolean {
        if (steps.length !== this.size()) {
            return false;
        }
        const flowStepNames = Object.keys(this.tests);
        for (let i = 0; i < steps.length; i++) {
            if (steps[i].name !== flowStepNames[i]) {
                return false;
            }
        }
        return true;
    }

    /**
     * Returns all reachable unique steps in this.plyFlow.
     * These are the tests in this FlowSuite.
     */
    getSteps(): Step[] {
        const steps: { step: flowbee.Step, subflow?: flowbee.Subflow}[] = [];

        const addSteps = (startStep: flowbee.Step, subflow?: flowbee.Subflow) => {
            const already = steps.find(step => step.step.id === startStep.id);
            if (!already) {
                steps.push({ step: startStep, subflow });
                if (startStep.links) {
                    for (const link of startStep.links) {
                        let outStep: flowbee.Step | undefined;
                        if (subflow) {
                            outStep = subflow.steps?.find(s => s.id === link.to);
                        } else {
                            outStep = this.plyFlow.flow.steps?.find(s => s.id === link.to);
                        }
                        if (outStep) {
                            addSteps(outStep, subflow);
                        }
                    }
                }
            }
        };

        this.plyFlow.flow.subflows?.filter(sub => sub.attributes?.when === 'Before')?.forEach(before => {
            before.steps?.forEach(step => addSteps(step, before));
        });

        this.plyFlow.flow.steps?.forEach(step => addSteps(step));

        this.plyFlow.flow.subflows?.filter(sub => sub.attributes?.when === 'After')?.forEach(after => {
            after.steps?.forEach(step => addSteps(step, after));
        });

        return steps.map(step => {
            return {
                name: step.subflow ? `${step.subflow.id}.${step.step.id}` : step.step.id,
                type: 'flow',
                step: step.step,
                ...(step.subflow) && { subflow: step.subflow }
            };
        });
    }
}

export class FlowLoader {

    private skip: Skip | undefined;

    constructor(
        readonly locations: string[],
        private options: PlyOptions
    ) {
        if (options.skip) {
            this.skip = new Skip(options.testsLocation, options.skip);
        }
    }

    async load(): Promise<FlowSuite[]> {
        const retrievals = this.locations.map(loc => new Retrieval(loc));
        // load request files in parallel
        const promises = retrievals.map(retr => this.loadSuite(retr));
        const suites = await Promise.all(promises);
        suites.sort((s1, s2) => s1.name.localeCompare(s2.name));
        return suites;
    }

    async loadSuite(retrieval: Retrieval): Promise<FlowSuite> {
        const contents = await retrieval.read();
        if (typeof contents === 'undefined') {
            throw new Error('Cannot retrieve: ' + retrieval.location.absolute);
        }
        const resultPaths = await ResultPaths.create(this.options, retrieval);
        resultPaths.isFlowResult = true;
        return this.buildSuite(retrieval, contents, resultPaths);
    }

    buildSuite(retrieval: Retrieval, contents: string, resultPaths: ResultPaths): FlowSuite {
        const runtime = new Runtime(
            this.options,
            retrieval,
            resultPaths
        );

        const logger = new Logger({
            level: this.options.verbose ? LogLevel.debug : (this.options.quiet ? LogLevel.error : LogLevel.info),
            prettyIndent: this.options.prettyIndent
        }, runtime.results.log);

        // request suite comprising all requests configured in steps
        const requestSuite = new Suite<Request>(
            retrieval.location.base,
            'request',
            retrieval.location.relativeTo(this.options.testsLocation),
            runtime,
            logger,
            0, 0
        );

        const flowbeeFlow = FlowLoader.parse(contents, retrieval.location.path);
        requestSuite.callingFlowPath = flowbeeFlow.path;

        const plyFlow = new PlyFlow(flowbeeFlow, requestSuite, logger);

        const suite = new FlowSuite(
            plyFlow,
            retrieval.location.relativeTo(this.options.testsLocation),
            runtime,
            logger,
            0,
            util.lines(contents).length - 1
        );

        for (const step of suite.getSteps()) {
            suite.add(step);
        }

        // mark if skipped
        if (this.skip?.isSkipped(suite.path)) {
            suite.skip = true;
        }

        return suite;
    }

    /**
     * Parse a flowbee flow from text (reproduced from flowbee.FlowDiagram)
     * @param text json or yaml
     * @param file file name
     */
    static parse(text: string, file: string): flowbee.Flow {
        let flow: flowbee.Flow;
        if (text.startsWith('{')) {
            try {
                flow = JSON.parse(text);
            } catch (err) {
                throw new Error(`Failed to parse ${file}: ${err.message}`);
            }
        } else {
            flow = yaml.load(file, text);
        }
        if (!flow) throw new Error(`Unable to load from empty: ${file}`);
        flow.type = 'flow';
        flow.path = file.replace(/\\/g, '/');
        return flow;
    }
}
