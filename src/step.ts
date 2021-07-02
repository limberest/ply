import * as flowbee from 'flowbee';
import { Logger, LogLevel } from './logger';
import { RunOptions } from './options';
import { Request, PlyRequest } from './request';
import { Runtime } from './runtime';
import { Suite } from './suite';
import { PlyTest, Test } from './test';
import { Result, ResultStatus } from './result';
import * as subst from './subst';
import * as util from './util';
import * as yaml from './yaml';

export interface Step extends Test {
    step: flowbee.Step;
    instance?: flowbee.StepInstance;
    subflow?: flowbee.Subflow;
}

export function getStepId(step: Step) {
    return step.subflow ? `${step.subflow.id}.${step.step.id}` : step.step.id;
}

export class PlyStep implements Step, PlyTest {

    /**
     * This is the step id.
     */
    readonly name: string;
    readonly type = 'flow';
    readonly stepName: string;
    readonly instance: flowbee.StepInstance;
    start?: number | undefined;
    end?: number | undefined;

    constructor(
        readonly step: flowbee.Step,
        private readonly requestSuite: Suite<Request>,
        private readonly logger: Logger,
        readonly flowPath: string,
        flowInstanceId: string,
        readonly subflow?: flowbee.Subflow,
    ) {
        this.name = getStepId(this);
        this.stepName = step.name.replace(/\r?\n/g, ' ');
        this.instance = {
            id: util.genId(),
            flowInstanceId,
            stepId: step.id,
            status: 'In Progress'
        };
    }

    async run(runtime: Runtime, values: object, runOptions?: RunOptions): Promise<Result> {
        this.instance.start = new Date();
        let result: Result;
        let stepRes: any;
        const level = this.subflow ? 1 : 0;
        try {
            runtime.appendResult(`${this.stepName}:`, level, runOptions?.createExpected, util.timestamp(this.instance.start));
            runtime.appendResult(`id: ${this.step.id}`, level + 1, runOptions?.createExpected);
            if (this.subflow && this.step.path === 'start' && !runOptions?.submit && !runOptions?.createExpected) {
                this.padActualStart(this.subflow.id);
            }
            else if (this.step.path === 'stop' && !this.subflow) {
                let name = this.flowPath;
                const lastSlash = name.lastIndexOf('/');
                if (lastSlash > 0 && lastSlash < name.length - 1) name = name.substring(lastSlash + 1);
                const runId = this.logger.level === LogLevel.debug ? ` (${this.instance.flowInstanceId})` : '';
                this.logger.info(`Finished flow: ${name}${runId}`);
            } else if (this.step.path === 'request') {
                let url = this.step.attributes?.url;
                if (!url) throw new Error('Missing attribute: url');
                url = subst.replace(url, values, this.logger);
                let method = this.step.attributes?.method;
                if (!method) throw new Error('Missing attribute: method');
                method = subst.replace(method, values, this.logger);
                const headers: {[key: string]: string} = {};
                if (this.step.attributes?.headers) {
                    const rows = JSON.parse(this.step.attributes.headers);
                    for (const row of rows) {
                        headers[row[0]] = subst.replace(row[1], values, this.logger);
                    }
                }
                let body = this.step.attributes?.body;
                if (body) {
                    body = subst.replace(body, values, this.logger);
                }

                const requestObj: Request = {
                    name: this.name,
                    type: 'request',
                    url,
                    method,
                    headers,
                    body,
                    submitted: new Date(),
                    submit: (_values: object) => { throw new Error('Not implemented'); }
                };

                const request = new PlyRequest(this.name, requestObj, this.logger, runtime.retrieval);
                if (request.isGraphQl) {
                    request.graphQl = body;
                    body = JSON.stringify({ query: body }, null, runtime.options?.prettyIndent);
                }

                this.instance.data = {
                    request: yaml.dump(request.getRequest(values, runtime.options), runtime.options.prettyIndent)
                };

                if (this.step.attributes?.submit === 'true') {
                    const response = await request.submit(values, runtime.options, { ...runOptions, submit: true });
                    this.instance.data.response = yaml.dump(response, runtime.options.prettyIndent);
                } else {
                    this.requestSuite.tests[this.name] = request;
                    const result = await this.requestSuite.run(this.name, values, runOptions);
                    if (result.status !== 'Passed' && result.status !== 'Submitted') {
                        this.instance.status = result.status === 'Failed' ? 'Failed' : 'Errored';
                        this.instance.message = result.message;
                    }
                    if (result.response) {
                        let response = result.response;
                        if (result.response.body) {
                            // convert from object
                            response = { ...result.response, body: JSON.stringify(result.response.body, null, runtime.options.prettyIndent) };
                        }
                        this.instance.data.response = yaml.dump(response, runtime.options.prettyIndent);
                    }
                }
            }
            if (this.instance.status === 'In Progress') { // not overwritten by step execution
                this.instance.status = 'Completed';
            }

            this.instance.end = new Date();

            if (!runOptions?.submit && !runOptions?.createExpected) {
                await this.padActualStart(this.name);
            }

            result = this.mapResult(runOptions);

        } catch (err) {
            this.logger.error(err.message, err);
            this.instance.status = 'Errored';
            this.instance.message = err.message;
            result = { name: this.stepName, status: 'Errored', message: this.instance.message || '' };
        }

        // append status, result and message to actual result
        if (this.instance.end) {
            const elapsed = this.instance.end.getTime() - this.instance.start.getTime();
            runtime.appendResult(`status: ${this.instance.status}`, level + 1, runOptions?.createExpected, `${elapsed} ms`);

            if (typeof stepRes === 'boolean' || typeof stepRes === 'number' || stepRes) {
                this.instance.result = '' + stepRes;
                runtime.appendResult(`result: ${this.instance.result}`, level + 1, runOptions?.createExpected);
            }
            if (this.instance.message) {
                runtime.appendResult(`message: '${this.instance.message}'`, level + 1, runOptions?.createExpected);
            }
        }

        return result;
    }

    private async padActualStart(name: string) {
        const expectedYaml = await this.requestSuite.runtime.results.getExpectedYaml(name);
        if (expectedYaml.start > 0) {
            const actualYaml = this.requestSuite.runtime.results.getActualYaml(name);
            if (expectedYaml.start > actualYaml.start) {
                this.requestSuite.runtime.results.actual.padLines(actualYaml.start, expectedYaml.start - actualYaml.start);
            }
        }
    }

    /**
     * Maps instance status to ply result
     */
    private mapResult(runOptions?: RunOptions): Result {
        let resultStatus: ResultStatus;
        if (this.instance.status === 'In Progress' || this.instance.status === 'Waiting') {
            resultStatus = 'Pending';
        } else if (this.instance.status === 'Completed' || this.instance.status === 'Canceled') {
            resultStatus = runOptions?.submit ? 'Submitted' : 'Passed';
        } else {
            resultStatus = this.instance.status;
        }

        return { name: this.stepName, status: resultStatus, message: this.instance.message || '' };
    }
}