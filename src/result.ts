import * as yaml from './yaml';
import * as flowbee from 'flowbee';
import { Request } from './request';
import { Response, PlyResponse } from './response';
import { Location } from './location';
import { Storage } from './storage';
import { Retrieval } from './retrieval';
import { Options, PlyOptions } from './options';
import { Logger } from './logger';
import { CodeLine, Code } from './code';
import { Compare, Diff } from './compare';
import { Yaml } from './yaml';
import * as util from './util';

export type ResultStatus = 'Pending' | 'Passed' | 'Failed' | 'Errored' | 'Submitted';

export interface Outcome {
    /**
     * Status of test execution
     */
    status: ResultStatus
    message: string
    /**
     * One-based line number of first diff, relative to starting line of test
     */
    line?: number
    /**
     * Diff message
     */
    diff?: string
    diffs?: Diff[]

    start?: number
    end?: number
}

export interface Result extends Outcome {
    /**
     * Request name
     */
    readonly name: string,
    /**
     * Request with runtime substitutions, minus Authorization header
     */
    readonly request?: Request,
    /**
     * Response maybe with ignore headers removed, and formatted/sorted body content (per options)
     */
    readonly response?: Response
}

export class PlyResult implements Result {

    status: 'Pending' | 'Passed' | 'Failed' | 'Errored' | 'Submitted' = 'Pending';
    message = '';
    line = 0;
    diff?: string;
    request: Request;
    response: PlyResponse;
    graphQl?: string;

    constructor(readonly name: string, request: Request, response: PlyResponse) {
        this.request = { ...request };
        this.request.headers = { };
        Object.keys(request.headers).forEach( key => {
            if (key !== 'Authorization') {
                this.request.headers[key] = request.headers[key];
            }
        });
        this.response = response;
    }

    /**
     * Returns the result with request/response bodies as objects (if parseable).
     */
    getResult(options: Options): Result {
        // TODO: request
        return {
            name: this.name,
            status: this.status,
            message: this.message,
            request: this.request,
            response: this.response?.getResponse(this.response.runId, options)
        };
    }

    merge(outcome: Outcome) {
        this.status = outcome.status;
        this.message = outcome.message;
        this.line = outcome.line || 0;
        this.diff = outcome.diff;
    }
}

export class Verifier {
    constructor(
        private readonly name: string,
        private readonly expectedYaml: Yaml,
        private readonly logger: Logger
    ) {}

    /**
     * Verify expected vs actual results yaml after substituting values.
     * Diffs/messages always contain \n newlines.
     */
    verify(actualYaml: Yaml, values: object): Outcome {
        // this.logger.debug(`Expected:\n${this.expectedYaml}\n` + `Actual:\n${actualYaml}\n`);
        const expected = new Code(this.expectedYaml.text, '#');
        const actual = new Code(actualYaml.text, '#');
        const diffs = new Compare(this.logger).diffLines(expected.extractCode(), actual.extractCode(), values);
        let firstDiffLine = 0;
        let diffMsg = '';
        if (diffs) {
            let line = 1;
            let actLine = 1;
            for (let i = 0; i < diffs.length; i++) {
                const diff = diffs[i];
                if (diff.removed) {
                    const correspondingAdd = (i < diffs.length - 1 && diffs[i + 1].added) ? diffs[i + 1] : null;
                    if (!diff.ignored) {
                        if (!firstDiffLine) {
                            firstDiffLine = line;
                        }
                        diffMsg += this.diffLine(line, diff.count);
                        diffMsg += '\n';
                        diffMsg += this.prefix(diff.value, '- ', expected.lines, line);
                        if (correspondingAdd) {
                            diffMsg += this.prefix(correspondingAdd.value, '+ ', actual.lines, actLine);
                        }
                        diffMsg += '===\n';
                    }
                    line += diff.count;
                    if (correspondingAdd) {
                        i++; // corresponding add already covered
                        actLine += correspondingAdd.count;
                    }
                }
                else if (diff.added) {
                    if (!diff.ignored) {
                        // added with no corresponding remove
                        if (!firstDiffLine) {
                            firstDiffLine = line;
                        }
                        diffMsg += '-> ' + this.diffLine(actLine, diff.count);
                        diffMsg += '\n';
                        diffMsg += this.prefix(diff.value, '+ ', actual.lines, actLine);
                        diffMsg += '===\n';
                    }
                    actLine += diff.count;
                }
                else {
                    line += diff.count;
                    actLine += diff.count;
                }
            }
        }
        if (firstDiffLine) {
            return {
                status: 'Failed',
                message: `Results differ from line ${this.diffLine(firstDiffLine, 1, this.name)}`,
                line: firstDiffLine,
                diff: diffMsg,
                diffs
            };
        }
        else {
            return {
                status: 'Passed',
                message: 'Test succeeded',
                line: 0
            };
        }
    }

    private diffLine(line: number, count = 1, name?: string): string {
        if (typeof this.expectedYaml.start === 'undefined') {
            return '' + line;
        }
        let dl = `${line + this.expectedYaml.start}`;
        if (count > 1) {
            dl += `-${line + this.expectedYaml.start + count - 1}`;
        }
        if (this.expectedYaml.start > 0) {
            dl += ' (';
            if (name) {
                dl += name + ':';
            }
            dl += line;
            if (count > 1) {
                dl += `-${line + count - 1}`;
            }
            dl += ')';
        }
        return dl;
    }

    /**
     * Adds pre to the beginning of each line in str (except trailing newline).
     * Optional codeLines, start to restore comments.
     */
    private prefix(str: string, pre: string, codeLines: CodeLine[], start: number): string {
        return util.lines(str).reduce((a, seg, i, arr) => {
            let line = i === arr.length - 1 && seg.length === 0 ? '' : pre + seg;
            if (line) {
                if (codeLines) {
                    const codeLine = codeLines[start + i];
                    if (codeLine.comment) {
                        line += codeLine.comment;
                    }
                }
                line += '\n';
            }
            return a + line;
        }, '');
    }
}

export class ResultPaths {

    isFlowResult = false;

    private constructor(
        readonly expected: Retrieval,
        readonly actual: Storage,
        readonly options: Options,
        readonly log: Storage
    ) { }

    /**
     * excluding file extension
     */
    private static bases(options: PlyOptions, retrieval: Retrieval, suiteName: string):
            { expected: string, actual: string, log: string } {

        if (suiteName.endsWith('.ply')) {
            suiteName = suiteName.substring(0, suiteName.length - 4);
        }

        if (options.resultFollowsRelativePath && retrieval.location.isChildOf(options.testsLocation)) {
            const relPath = retrieval.location.relativeTo(options.testsLocation);
            const parent = new Location(relPath).parent; // undefined if relPath is just filename
            const resultFilePath = parent ? parent + '/' + suiteName : suiteName;
            return {
                expected: options.expectedLocation + '/' + resultFilePath,
                actual: options.actualLocation + '/' + resultFilePath,
                log: options.logLocation + '/' + resultFilePath
            };
        }
        else {
            // flatly use the specified paths
            return {
                expected: options.expectedLocation + '/' + suiteName,
                actual: options.actualLocation + '/' + suiteName,
                log: options.logLocation + '/' + suiteName
            };
        }
    }

    /**
     * Figures out locations and file extensions for results.
     * Result file path relative to configured result location is the same as retrieval relative
     * to configured tests location.
     */
    static async create(options: PlyOptions, retrieval: Retrieval, suiteName = retrieval.location.base): Promise<ResultPaths> {
        const basePaths = this.bases(options, retrieval, suiteName);
        let ext = '.yml';
        if (!await new Retrieval(basePaths.expected + '.yml').exists) {
            if ((await new Retrieval(basePaths.expected + '.yaml').exists) || retrieval.location.ext === 'yaml') {
                ext = '.yaml';
            }
        }
        return new ResultPaths(
            new Retrieval(basePaths.expected + ext),
            new Storage(basePaths.actual + ext),
            options,
            new Storage(basePaths.log + '.log')
        );
    }

    /**
     * Figures out locations and file extensions for results.
     * Result file path relative to configured result location is the same as retrieval relative
     * to configured tests location.
     */
    static createSync(options: PlyOptions, retrieval: Retrieval, suiteName = retrieval.location.base): ResultPaths {
        const basePaths = this.bases(options, retrieval, suiteName);
        let ext = '.yml';
        if (!new Storage(basePaths.expected + '.yml').exists) {
            if (new Storage(basePaths.expected + '.yaml').exists || retrieval.location.ext === 'yaml') {
                ext = '.yaml';
            }
        }
        return new ResultPaths(
            new Retrieval(basePaths.expected + ext),
            new Storage(basePaths.actual + ext),
            options,
            new Storage(basePaths.log + '.log')
        );
    }

    static extractById(yamlObj: any, id: string, indent = 2): any {
        const dot = id.indexOf('.');
        if (dot > 0) {
            const subflowId = id.substring(0, dot);
            id = id.substring(dot + 1);
            for (const key of Object.keys(yamlObj)) {
                if (yamlObj[key].id === subflowId) {
                    const subflowStart = (yamlObj[key].__start || 0) + 1;
                    yamlObj = yaml.load(key, yaml.dump(yamlObj[key], indent), true);
                    for (const value of Object.values(yamlObj)) {
                        if (typeof value === 'object' && typeof (value as any).__start === 'number') {
                            (value as any).__start += subflowStart;
                        }
                    }
                    break;
                }
            }
        }
        for (const key of Object.keys(yamlObj)) {
            if (yamlObj[key].id === id) {
                return yamlObj[key];
            }
        }
    }

    /**
     * Newlines are always \n.
     */
    async getExpectedYaml(name?: string): Promise<Yaml> {
        let expected = await this.expected.read();
        if (typeof expected === 'undefined') {
            throw new Error(`Expected result file not found: ${this.expected}`);
        }
        if (name) {
            let expectedObj;
            if (this.isFlowResult) {
                // name is (subflowId.)stepId
                expectedObj = ResultPaths.extractById(yaml.load(this.expected.toString(), expected, true), name, this.options.prettyIndent);
            } else {
                expectedObj = yaml.load(this.expected.toString(), expected, true)[name];
            }
            if (!expectedObj) {
                throw new Error(`Expected result not found: ${this.expected}#${name}`);
            }
            let expectedLines: string[];
            if (this.isFlowResult) {
                // exclude step info from request expected
                const {
                    __start: start,
                    __end: _end,
                    status: _status,
                    result: _result,
                    message: _message,
                    ...rawObj
                } = expectedObj;
                const startLine = util.lines(expected)[start];
                let indent = this.options.prettyIndent || 2;
                expected = yaml.dump(rawObj, indent);
                if (name.startsWith('f')) {
                    indent += (this.options.prettyIndent || 2); // extra indent for subflow
                }
                expectedLines = util.lines(expected).map(l => l.trim().length > 0 ? l.padStart(l.length + indent) : l);
                expectedLines.unshift(startLine);
                return { start, text: expectedLines.join('\n') };
            } else {
                expectedLines = util.lines(expected);
                return {
                    start: expectedObj.__start || 0,
                    text: expectedLines.slice(expectedObj.__start, expectedObj.__end + 1).join('\n')
                };
            }

        } else {
            return { start: 0, text: expected };
        }
    }

    async expectedExists(name?: string): Promise<boolean> {
        const expected = await this.expected.read();
        if (typeof expected === 'undefined') return false;
        if (name) {
            const obj = yaml.load(this.expected.toString(), expected);
            if (this.isFlowResult) {
                return !!ResultPaths.extractById(obj, name);
            } else {
                return !!obj[name];
            }
        } else {
            return true;
        }
    }

    /**
     * Newlines are always \n.  Trailing \n is appended.
     */
    getActualYaml(name?: string): Yaml {
        const actual = this.actual.read();
        if (typeof actual === 'undefined') {
            throw new Error(`Actual result file not found: ${this.actual}`);
        }
        if (name) {
            let actualObj;
            if (this.isFlowResult) {
                actualObj = ResultPaths.extractById(yaml.load(this.actual.toString(), actual, true), name, this.options.prettyIndent);

            } else {
                actualObj = yaml.load(this.actual.toString(), actual, true)[name];
            }
            if (!actualObj) {
                throw new Error(`Actual result not found: ${this.actual}#${name}`);
            }
            const actualLines = util.lines(actual);
            return {
                start: actualObj.__start || 0,
                text: actualLines.slice(actualObj.__start, actualObj.__end + 1).join('\n') + '\n'
            };
        } else {
            return { start: 0, text: actual };
        }
    }

    flowInstanceFromActual(flowPath: string): flowbee.FlowInstance | undefined {
        if (this.actual.exists) {
            return new ResultFlowParser(this.actual, this.options).parse(flowPath);
        }
    }
}

/**
 * Parses a flow instance from actual results.
 */
export class ResultFlowParser {

    private actualYaml: string;
    private yamlLines: string[];
    private actualObj: any;

    constructor(actualResult: Storage, private readonly options: Options) {
        const contents = actualResult.read();
        if (typeof contents === 'undefined') {
            throw new Error(`Actual result not found: ${actualResult}`);
        }
        this.actualYaml = contents;
        this.yamlLines = util.lines(this.actualYaml);
        this.actualObj = yaml.load(actualResult.toString(), this.actualYaml, true);
    }

    parse(flowPath: string): flowbee.FlowInstance | undefined {

        const flowInstance: flowbee.FlowInstance = {
            id: '',
            flowPath,
            status: 'Pending'
        };

        for (const key of Object.keys(this.actualObj)) {
            const obj = this.actualObj[key];
            if (obj.id.startsWith('f')) {
                const subflowInstance: flowbee.SubflowInstance = {
                    id: '',
                    subflowId: obj.id,
                    status: obj.status,
                    flowInstanceId: ''
                };
                this.parseStartEnd(subflowInstance, obj);
                // reparse subflow for step instance line numbers
                const subflowObj = yaml.load(key, yaml.dump(obj, 2), true);
                subflowInstance.stepInstances = this.getStepInstances(subflowObj, obj.__start + 1);
                if (!flowInstance.subflowInstances) flowInstance.subflowInstances = [];
                flowInstance.subflowInstances!.push(subflowInstance);
            }
        }
        flowInstance.stepInstances = this.getStepInstances(this.actualObj);
        flowInstance.stepInstances.forEach(stepInst => {
            if (flowInstance.status === 'Pending') flowInstance.status = 'In Progress';
            if (flowInstance.status === 'In Progress' && stepInst.status !== 'Completed') {
                flowInstance.status = stepInst.status;
            }
        });
        if (flowInstance.status === 'In Progress') flowInstance.status = 'Completed';
        return flowInstance;
    }


    getStepInstances(obj: any, offset = 0): flowbee.StepInstance[] {
        const stepInstances: flowbee.StepInstance[] = [];
        for (const stepKey of Object.keys(obj)) {
            const stepObj = obj[stepKey];
            if (stepObj.id?.startsWith('s')) {
                const stepInstance: flowbee.StepInstance = {
                    id: '',
                    stepId: stepObj.id,
                    status: stepObj.status,
                    flowInstanceId: ''
                };
                this.parseStartEnd(stepInstance, stepObj, offset);
                if (stepObj.request) {
                    stepInstance.data = { request: yaml.dump(stepObj.request, this.options.prettyIndent || 2) };
                    if (stepObj.response) {
                        stepInstance.data.response = yaml.dump(stepObj.response, this.options.prettyIndent || 2);
                    }
                }
                stepInstances.push(stepInstance);
            }
        }
        return stepInstances;
    }

    parseStartEnd(flowElementInstance: flowbee.StepInstance | flowbee.SubflowInstance, obj: any, offset = 0) {
        const startTimeComment = util.lineComment(this.yamlLines[obj.__start + offset]);
        if (startTimeComment) {
            flowElementInstance.start = util.timeparse(startTimeComment);
            if (flowElementInstance.start && this.yamlLines.length > obj.__end) {
                const elapsedMsComment = util.lineComment(this.yamlLines[obj.__end + offset]);
                if (elapsedMsComment) {
                    const elapsedMs = parseInt(elapsedMsComment.substring(0, elapsedMsComment.length - 2));
                    flowElementInstance.end = new Date(flowElementInstance.start.getTime() + elapsedMs);
                }
            }
        }
    }
}
