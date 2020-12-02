import * as yaml from './yaml';
import * as util from './util';
import { TestType, Test, PlyTest } from './test';
import { Result, Outcome, Verifier, PlyResult } from './result';
import { Location } from './location';
import { Storage } from './storage';
import { Logger } from './logger';
import { Runtime, DecoratedSuite, ResultPaths, CallingCaseInfo, CallingFlowInfo } from './runtime';
import { RunOptions } from './options';
import { SUITE, TEST, RESULTS } from './names';
import { Retrieval } from './retrieval';
import { EventEmitter } from 'events';
import { Plyee } from './ply';
import { PlyEvent, SuiteEvent, OutcomeEvent } from './event';
import { PlyResponse } from './response';
import { TsCompileOptions } from './compile';
import { PlyFlow } from './flow';

interface Tests<T extends Test> {
    [key: string]: T
}

/**
 * A suite represents one ply requests file (.ply.yaml), one ply case file (.ply.ts),
 * or one flow file (.ply.flow);
 *
 * Suites cannot be nested.
 */
export class Suite<T extends Test> {

    readonly tests: Tests<T> = {};
    emitter?: EventEmitter;
    skip = false;
    callingFlowInfo?: CallingFlowInfo;

    /**
     * @param name suite name
     * @param type request|case|flow
     * @param path relative path from tests location (forward slashes)
     * @param runtime info
     * @param logger
     * @param start zero-based start line
     * @param end zero-based end line
     * @param className? className for decorated suites
     * @param outFile? outputFile for decorated suites (absolute)
     */
    constructor(
        readonly name: string,
        readonly type: TestType,
        readonly path: string,
        readonly runtime: Runtime,
        readonly logger: Logger,
        readonly start: number = 0,
        readonly end: number,
        readonly className?: string,
        readonly outFile?: string
    ) { }

    add(test: T) {
        this.tests[test.name] = test;
    }

    get(name: string): T | undefined {
        return this.tests[name];
    }

    all(): T[] {
        return Object.values(this.tests);
    }

    size(): number {
        return Object.keys(this.tests).length;
    }

    *[Symbol.iterator]() {
        yield* this.all()[Symbol.iterator]();
    }

    get log(): Logger {
        return this.logger;
    }

    /**
     * Run one test, write actual result, and verify vs expected.
     * @param values runtime values for substitution
     * @returns result indicating outcome
     */
    async run(name: string, values: object, runOptions?: RunOptions): Promise<Result>;
    /**
     * Run specified tests, write actual results, and verify vs expected.
     * @param values runtime values for substitution
     * @returns result array indicating outcomes
     */
    async run(names: string[], values: object, runOptions?: RunOptions): Promise<Result[]>;
    /**
     * Run all tests, write actual results, and verify vs expected.
     * @param values runtime values for substitution
     * @returns result array indicating outcomes
     */
    async run(values: object, runOptions?: RunOptions): Promise<Result[]>;
    async run(namesOrValues: object | string | string[], valuesOrRunOptions?: object | RunOptions, runOptions?: RunOptions): Promise<Result | Result[]> {
        if (typeof namesOrValues === 'string') {
            const name = namesOrValues;
            const test = this.get(name);
            if (!test) {
                throw new Error(`Test not found: ${name}`);
            }
            const results = await this.runTests([test], valuesOrRunOptions || {}, runOptions);
            return results[0];
        }
        else if (Array.isArray(namesOrValues)) {
            const names = typeof namesOrValues === 'string' ? [namesOrValues] : namesOrValues;
            const tests = names.map(name => {
                const test = this.get(name);
                if (!test) {
                    throw new Error(`Test not found: ${name}`);
                }
                return test;
            }, this);
            return await this.runTests(tests, valuesOrRunOptions || {}, runOptions);
        }
        else {
            // run all tests
            return await this.runTests(this.all(), namesOrValues, valuesOrRunOptions);
        }
    }

    /**
     * Tests within a suite are run sequentially.
     * @param tests
     */
    private async runTests(tests: T[], values: object, runOptions?: RunOptions): Promise<Result[]> {

        if (runOptions && Object.keys(runOptions).length > 0) {
            this.log.debug('RunOptions', runOptions);
        }

        if (this.emitter) {
            this.emitter.emit('suite', {
                plyee: this.runtime.options.testsLocation + '/' + this.path,
                type: this.type,
                status: 'Started'
            } as SuiteEvent);
        }

        // runtime values are a deep copy of passed values
        this.runtime.values = JSON.parse(JSON.stringify(values));
        this.runtime.responseHeaders = undefined;

        let callingCaseInfo: CallingCaseInfo | undefined;
        try {
            if (this.className) {
                // running a case suite --
                // initialize the decorated suite
                let testFile;
                if (runOptions?.useDist && this.outFile) {
                    testFile = this.outFile;
                }
                else {
                    testFile = this.runtime.testsLocation.toString() + '/' + this.path;
                }
                const mod = await import(testFile);
                const clsName = Object.keys(mod).find(key => key === this.className);
                if (!clsName) {
                    throw new Error(`Suite class ${this.className} not found in ${testFile}`);
                }
                const inst = new mod[clsName]();
                this.runtime.decoratedSuite = new DecoratedSuite(inst);
                this.runtime.results.actual.remove();
            }
            else {
                // running a request suite
                if (this.callingFlowInfo) {
                    this.runtime.results = this.callingFlowInfo.results;
                    this.logger.storage = this.callingFlowInfo.results.log;
                } else {
                    callingCaseInfo = await this.getCallingCaseInfo(runOptions);
                    if (callingCaseInfo) {
                        this.runtime.results = callingCaseInfo.results;
                        this.logger.storage = callingCaseInfo.results.log;
                    }
                    else {
                        this.runtime.results.actual.remove();
                    }
                }
            }
        } catch (err) {
            // all tests are Errored
            this.logger.error(err.message, err);
            const results: Result[] = [];
            for (const test of tests) {
                const result = { name: test.name, status: 'Errored', message: '' + err.message } as Result;
                results.push(result);
                this.logOutcome(test, result);
            }
            return results;
        }

        const padActualStart = callingCaseInfo ? false : this.declaredStartsWith(tests);
        let expectedExists = await this.runtime.results.expected.exists;

        const results: Result[] = [];
        // within a suite, tests are run sequentially
        for (let i = 0; i < tests.length; i++) {
            const test = tests[i];
            const start = Date.now();
            if (test.type === 'case') {
                this.runtime.results.actual.append(test.name + ':\n');
            }
            let result: Result;
            try {
                this.logger.debug(`Running ${test.type}: ${test.name}`);
                if (this.emitter) {
                    const plyEvent: PlyEvent = { plyee: new Plyee(this.runtime.options.testsLocation + '/' + this.path, test).path };
                    if (test.type === 'flow') {
                        const flow: PlyFlow = test as any;
                        flow.onFlow(flowEvent => {
                            if (flowEvent.eventType !== 'exec') { // exec not applicable for ply subscribers
                                this.emitter?.emit('flow', flowEvent);
                            }
                        });
                    }
                    this.emitter.emit('test', plyEvent );
                }
                // determine wanted headers (for requests)
                if (test.type === 'request') {
                    this.runtime.responseHeaders = await this.getExpectedResponseHeaders(test.name, callingCaseInfo?.caseName);
                }
                result = await (test as unknown as PlyTest).run(this.runtime, runOptions);
                let actualYaml: yaml.Yaml;
                if (test.type === 'request') {
                    const plyResult = result as PlyResult;
                    const indent = callingCaseInfo ? this.runtime.options.prettyIndent : 0;
                    actualYaml = { start: 0, text: this.buildResultYaml(plyResult, indent) };
                    this.runtime.results.actual.append(actualYaml.text);
                    if (!callingCaseInfo) {
                        if (expectedExists && this.callingFlowInfo) {
                            // expectedExists based on specific request step
                            expectedExists = await this.runtime.results.expectedExists(test.name);
                        }
                        const isFirst = i === 0 && !this.callingFlowInfo;
                        result = this.handleResultRunOptions(test, result, actualYaml.text, isFirst, expectedExists, runOptions) || result;
                        // status could be 'Submitted' if runOptions so specify
                        if (result.status === 'Pending') {
                            // verify request result (otherwise wait until case/flow is complete)
                            const expectedYaml = await this.runtime.results.getExpectedYaml(test.name, undefined, !!this.callingFlowInfo);
                            if (expectedYaml.start > 0) {
                                actualYaml = this.runtime.results.getActualYaml(test.name);
                                if (padActualStart && expectedYaml.start > actualYaml.start) {
                                    this.runtime.results.actual.padLines(actualYaml.start, expectedYaml.start - actualYaml.start);
                                }
                            }
                            const verifier = new Verifier(test.name, expectedYaml, this.logger);
                            this.log.debug(`Comparing ${this.runtime.results.expected.location} vs ${this.runtime.results.actual.location}`);
                            const outcome = { ...verifier.verify(actualYaml, this.runtime.values), start };
                            result = { ...result as Result, ...outcome };
                            this.logOutcome(test, outcome);
                        }
                    }
                    this.addResult(results, result);
                } else {
                    // case or flow complete -- verify result
                    actualYaml = this.runtime.results.getActualYaml(this.type === 'flow' ? '' : test.name);
                    result = this.handleResultRunOptions(test, result, actualYaml.text, i === 0, expectedExists, runOptions) || result;
                    // for cases status could be 'Submitted' if runOptions so specify (this check is handled at step level for flows)
                    if (result.status === 'Pending' || this.type === 'flow') {
                        const expectedYaml = await this.runtime.results.getExpectedYaml(this.type === 'flow' ? '' : test.name);
                        if (padActualStart && expectedYaml.start > actualYaml.start) {
                            this.runtime.results.actual.padLines(actualYaml.start, expectedYaml.start - actualYaml.start);
                        }
                        const verifier = new Verifier(test.name, expectedYaml, this.logger);
                        this.log.debug(`Comparing ${this.runtime.results.expected.location} vs ${this.runtime.results.actual.location}`);
                        // NOTE: By using this.runtime.values we're unadvisedly taking advantage of the prototype's shared runtime object property
                        // (https://stackoverflow.com/questions/17088635/javascript-object-properties-shared-across-instances).
                        // This allows us to accumulate programmatic values changes like those in updateRating() in movieCrud.ply.ts
                        // so that they can be accessed when verifying here, even though the changes are not present the passed 'values' parameter.
                        // TODO: Revisit when implementing a comprehensive values specification mechanism.
                        const outcome = { ...verifier.verify(actualYaml, this.runtime.values), start };
                        result = { ...result as Result, ...outcome };
                        this.logOutcome(test, outcome);
                    }
                    this.addResult(results, result);
                }
            } catch (err) {
                this.logger.error(err.message, err);
                result = {
                    name: test.name,
                    status: 'Errored',
                    message: err.message,
                    start
                };
                this.addResult(results, result);
                this.logOutcome(test, result);
            }

            if (this.runtime.options.bail && result.status !== 'Passed' && result.status !== 'Submitted') {
                break;
            }
        }

        if (this.emitter) {
            this.emitter.emit('suite', {
                plyee: this.runtime.options.testsLocation + '/' + this.path,
                type: this.type,
                status: 'Finished'
            } as SuiteEvent);
        }

        return results;
    }

    private declaredStartsWith(tests: T[]): boolean {
        const names = Object.keys(this.tests);
        for (let i = 0; i < names.length; i++) {
            if (tests.length > i && names[i] !== tests[i].name) {
                return false;
            }
        }
        return true;
    }

    /**
     * Translates request/response bodies to objects and
     * adds to array.  Also adds to values object for downstream access.
     * @param results
     * @param result
     */
    private addResult(results: Result[], result: Result) {
        let plyResult;
        if (result instanceof PlyResult) {
            plyResult = result as PlyResult;
        }
        else if (result.request && result.response instanceof PlyResponse) {
            plyResult = new PlyResult(result.name, result.request, result.response);
            plyResult.merge(result);
        }
        if (plyResult) {
            result = plyResult.getResult(this.runtime.options);
        }
        let resultsVal = (this.runtime.values as any)[RESULTS];
        if (!resultsVal) {
            resultsVal = {};
            (this.runtime.values as any)[RESULTS] = resultsVal;
        }
        resultsVal[result.name] = result;
        results.push(result);
    }

    // TODO: consider caching expected yaml content and possibly loaded obj (since obj is loaded twice for requests)
    private async getExpectedResponseHeaders(requestName: string, caseName?: string): Promise<string[] | undefined> {
        const expectedYaml = await this.runtime.results.expected.read();
        if (expectedYaml) {
            const expectedObj = yaml.load(this.runtime.results.expected.toString(), expectedYaml);
            let obj = caseName ? expectedObj[caseName] : expectedObj;
            if (obj) {
                obj = obj[requestName];
            }
            const response = obj?.response;
            if (response) {
                return response.headers ? Object.keys(response.headers) : [];
            }
        }
    }

    private handleResultRunOptions(test: Test, result: Result, actualYamlText: string,
        isFirst: boolean, expectedExists: boolean, runOptions?: RunOptions): Result | undefined {

        if (runOptions?.submit || (!expectedExists && runOptions?.submitIfExpectedMissing)) {
            const res = {
                name: test.name,
                status: 'Submitted',
                request: result.request,
                response: result.response
            } as Result;
            this.logOutcome(test, res);
            return res;
        }
        if (runOptions?.createExpected || (!expectedExists && runOptions?.createExpectedIfMissing)) {
            if (this.runtime.results.expected.location.isUrl) {
                throw new Error('Run option createExpected not supported for remote results');
            }
            const expected = new Storage(this.runtime.results.expected.location.toString());
            if (isFirst) {
                this.log.info(`Creating expected result: ${expected}`);
                expected.write(actualYamlText);
            }
            else {
                expected.append(actualYamlText);
            }
        }
    }

    logOutcome(test: Test, outcome: Outcome, label?: string) {
        outcome.end = Date.now();
        const ms = outcome.start ? ` in ${outcome.end - outcome.start} ms` : '';
        const testLabel = label || test.type.charAt(0).toLocaleUpperCase() + test.type.substring(1);
        if (outcome.status === 'Passed') {
            this.logger.info(`${testLabel} '${test.name}' PASSED${ms}`);
        }
        else if (outcome.status === 'Failed') {
            const diff = outcome.diff ? '\n' + outcome.diff : '';
            this.logger.error(`${testLabel} '${test.name}' FAILED${ms}: ${outcome.message}${diff}`);
        }
        else if (outcome.status === 'Errored') {
            this.logger.error(`${testLabel} '${test.name}' ERRORED${ms}: ${outcome.message}`);
        }
        else if (outcome.status === 'Submitted') {
            this.logger.info(`${testLabel} '${test.name}' SUBMITTED${ms}`);
        }
        if (this.emitter) {
            this.emitter.emit('outcome', {
                plyee: new Plyee(this.runtime.options.testsLocation + '/' + this.path, test).path,
                outcome
            } as OutcomeEvent);
        }
    }

    /**
     * Use stack trace to find calling case info (if any) for request.
     */
    private async getCallingCaseInfo(runOptions?: RunOptions): Promise<CallingCaseInfo | undefined> {
        const stacktracey = 'stacktracey';
        const StackTracey = await import(stacktracey);
        const stack = new StackTracey();
        const plyCaseInvoke = stack.findIndex((elem: {callee: string;}) => {
            return elem.callee === 'PlyCase.run' || elem.callee === 'async PlyCase.run';
        });
        if (plyCaseInvoke > 0) {
            const element = stack[plyCaseInvoke - 1];
            const dot = element.callee.indexOf('.');
            if (dot > 0 && dot < element.callee.length - 1) {
                let clsName = element.callee.substring(0, dot);
                if (clsName.startsWith('async ')) {
                    clsName = clsName.substring(6);
                }

                const mod = await import(element.file);
                const cls = mod[clsName];
                const suiteName = cls[SUITE].name;
                const mthName = element.callee.substring(dot + 1);
                const mth = cls.prototype[mthName];
                const caseName = mth[TEST].name;

                let source = element.file;
                if (runOptions?.useDist || !source) {
                    // Note: this doesn't work with ts compiler option outFile (relies on outDir)
                    const outDir = new TsCompileOptions(this.runtime.options).outDir;
                    const relLoc = new Location(new Location(element.file).relativeTo(outDir));
                    source = relLoc.parent + '/' + relLoc.base + '.ts';
                }

                const results = await ResultPaths.create(this.runtime.options, new Retrieval(source), suiteName);

                return { results, suiteName, caseName };
            }
        }
    }

    /**
     * Always contains \n newlines.  Includes trailing newline.
     */
    private buildResultYaml(result: PlyResult, indent: number): string {

        const { name: _name, type: _type, submitted: _submitted, ...leanRequest } = result.request;
        if (result.graphQl) {
            leanRequest.body = result.graphQl;  // restore graphQl for better comparisons
        }
        const { time: _time, ...leanResponse } = result.response;

        let invocationObject = {
            [result.name]: {
                request: leanRequest,
                response: leanResponse
            }
        };

        let yml = yaml.dump(invocationObject, this.runtime.options.prettyIndent);

        // parse for line numbers
        const baseName = this.runtime.results.actual.location.base;
        invocationObject = yaml.load(baseName, yml, true);
        let ymlLines = yml.split('\n');
        if (indent) {
            ymlLines = ymlLines.map((line, i) => {
                if (i < ymlLines.length - 1) {
                    return line.padStart(line.length + indent);
                }
                else {
                    return line;
                }
            });
        }
        const invocation = invocationObject[result.name] as any;
        if (typeof invocation.__start !== 'undefined') {
            const outcomeLine = invocation.__start;
            if (result.request.submitted) {
                ymlLines[outcomeLine] += `  # ${util.timestamp(result.request.submitted)}`;
            }
            if (typeof result.response.time !== 'undefined') {
                const responseMs = result.response.time + ' ms';
                const requestYml = yaml.dump({ request: invocation.request }, this.runtime.options.prettyIndent);
                ymlLines[outcomeLine + requestYml.split('\n').length] += `  # ${responseMs}`;
            }
        }

        if (this.callingFlowInfo) {
            // name already appended with step output
            ymlLines.shift();
        }
        yml = ymlLines.join('\n');

        return yml;
    }
}
