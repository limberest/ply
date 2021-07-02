import * as path from 'path';
import { EventEmitter } from 'events';
import { Options, Config, PlyOptions, RunOptions, Defaults } from './options';
import { Suite } from './suite';
import { Test } from './test';
import { Request } from './request';
import { Case } from './case';
import { CaseLoader } from './cases';
import { RequestLoader } from './requests';
import { Result } from './result';
import { TsCompileOptions } from './compile';
import { Logger, LogLevel } from './logger';
import * as util from './util';
import { FlowLoader, FlowSuite } from './flows';
import { Values } from './values';
import { PlyRunner } from './runner';

export class Ply {

    readonly options: PlyOptions;

    constructor(options?: Options) {
        this.options = Object.assign({}, new Defaults(), options || new Config().options);
    }

    /**
     * Load request suites.
     * @param locations can be URLs or file paths
     */
    async loadRequests(location: string): Promise<Suite<Request>[]>;
    async loadRequests(...locations: string[]): Promise<Suite<Request>[]>;
    async loadRequests(locations: string[], ...moreLocations: string[]): Promise<Suite<Request>[]>;
    async loadRequests(locations: string | string[], ...moreLocations: string[]): Promise<Suite<Request>[]> {
        if (typeof locations === 'string') {
            locations = [locations];
        }
        if (moreLocations) {
            locations = [ ...locations, ...moreLocations ];
        }
        const requestLoader = new RequestLoader(locations, this.options);
        return await requestLoader.load();
    }

    /**
     * Throws if location or suite not found
     */
    async loadRequestSuite(location: string): Promise<Suite<Request>> {
        const requestSuites = await this.loadRequests([location]);
        if (requestSuites.length === 0) {
            throw new Error(`No request suite found in: ${location}`);
        }
        return requestSuites[0];
    }

    /**
     * Load request suites.
     * @param locations can be URLs or file paths
     */
    loadRequestsSync(location: string): Suite<Request>[];
    loadRequestsSync(...locations: string[]): Suite<Request>[];
    loadRequestsSync(locations: string[], ...moreLocations: string[]): Suite<Request>[];
    loadRequestsSync(locations: string | string[], ...moreLocations: string[]): Suite<Request>[] {
        if (typeof locations === 'string') {
            locations = [locations];
        }
        if (moreLocations) {
            locations = [ ...locations, ...moreLocations ];
        }
        const requestLoader = new RequestLoader(locations, this.options);
        return requestLoader.sync();
    }

    /**
     * Throws if location or suite not found
     */
    loadRequestSuiteSync(location: string): Suite<Request> {
        const requestSuites = this.loadRequestsSync([location]);
        if (requestSuites.length === 0) {
            throw new Error(`No request suite found in: ${location}`);
        }
        return requestSuites[0];
    }

    async loadSuite(location: string): Promise<Suite<Request>> {
        return await this.loadRequestSuite(location);
    }

    loadSuiteSync(location: string): Suite<Request> {
        return this.loadRequestSuiteSync(location);
    }

    /**
     * Throws if location or suite not found
     */
    async loadCaseSuites(location: string): Promise<Suite<Case>[]> {
        const caseSuites = await this.loadCases([location]);
        if (caseSuites.length === 0) {
            throw new Error(`No case suite found in: ${location}`);
        }
        return caseSuites;
    }

    async loadCases(file: string): Promise<Suite<Case>[]>;
    async loadCases(...files: string[]): Promise<Suite<Case>[]>;
    async loadCases(files: string[], ...moreFiles: string[]): Promise<Suite<Case>[]>;
    async loadCases(files: string | string[], ...moreFiles: string[]): Promise<Suite<Case>[]> {
        if (typeof files === 'string') {
            files = [files];
        }
        if (moreFiles) {
            files = [ ...files, ...moreFiles ];
        }
        const compileOptions = new TsCompileOptions(this.options);
        const caseLoader = new CaseLoader(files, this.options, compileOptions);

        const suites = await caseLoader.load();
        return suites;
    }

    /**
     * Throws if location or suite not found
     */
    async loadFlowSuites(location: string): Promise<FlowSuite[]> {
        const flowSuites = await this.loadFlows([location]);
        if (flowSuites.length === 0) {
            throw new Error(`No flow suite found in: ${location}`);
        }
        return flowSuites;
    }

    async loadFlows(file: string): Promise<FlowSuite[]>;
    async loadFlows(...files: string[]): Promise<FlowSuite[]>;
    async loadFlows(files: string[], ...moreFiles: string[]): Promise<FlowSuite[]>;
    async loadFlows(files: string | string[], ...moreFiles: string[]): Promise<FlowSuite[]> {
        if (typeof files === 'string') {
            files = [files];
        }
        if (moreFiles) {
            files = [ ...files, ...moreFiles ];
        }
        const flowLoader = new FlowLoader(files, this.options);
        const suites = await flowLoader.load();
        return suites;
    }
}

/**
 * A Plyee is a test (request/case), or a suite.
 *
 * Format: <absolute_suite_file_forward_slashes>#<optional_case_suite>^<test_name>
 * eg: c:/ply/ply/test/ply/requests/movie-queries.ply.yaml#moviesByYearAndRating
 * or: /Users/me/ply/ply/test/ply/cases/movieCrud.ply.ts#movie-crud^add new movie
 * or for a suite: /Users/me/ply/ply/test/ply/requests/movie-queries.ply.yaml
 * (TODO: handle caseFile#suite^case)
 */
export class Plyee {
    readonly path: string;
    private hash: number;
    private hat: number;

    constructor(suite: string, test: Test);
    constructor(path: string);
    constructor(pathOrSuite: string, test?: Test) {
        if (test) {
            this.path = util.fwdSlashes(path.normalize(path.resolve(`${pathOrSuite}#${test.name}`)));
        }
        else {
            this.path = util.fwdSlashes(path.normalize(path.resolve(pathOrSuite)));
        }
        this.hash = this.path.indexOf('#');
        if (this.hash === 0 || this.hash > this.path.length - 2) {
            throw new Error(`Invalid path: ${this.path}`);
        }
        this.hat = this.path.lastIndexOf('^');
        if (this.hat < this.hash || this.hat < this.path.length - 1) {
            this.hat = -1;
        }
    }

    get location(): string {
        if (this.hash > 0) {
            return this.path.substring(0, this.hash);
        }
        else {
            return this.path;
        }
    }

    get suite(): string {
        if (this.hat > 0) {
            return this.path.substring(this.hash + 1, this.hat);
        }
        else {
            return this.location;
        }
    }

    get test(): string | undefined {
        if (this.hash > 0) {
            if (this.hat > 0) {
                return this.path.substring(this.hat + 1);
            }
            else {
                return this.path.substring(this.hash + 1);
            }
        }
    }

    toString(): string {
        return this.path;
    }

    static isRequest(path: string): boolean {
        return path.endsWith('.yml') || path.endsWith('.yaml');
    }

    static isCase(path: string): boolean {
        return path.endsWith('.ts');
    }

    static isFlow(path: string): boolean {
        return path.endsWith('.flow');
    }

    /**
     * Maps plyee paths to Plyee by Suite.
     */
    static requests(paths: string[]): Map<string,Plyee[]> {
        return this.collect(paths, plyee => Plyee.isRequest(plyee.location));
    }

    static cases(paths: string[]): Map<string,Plyee[]> {
        return this.collect(paths, plyee => Plyee.isCase(plyee.location));
    }

    static flows(paths: string[]): Map<string,Plyee[]> {
        return this.collect(paths, plyee => Plyee.isFlow(plyee.location));
    }

    /**
     * Returns a map of unique suite location to Plyee[]
     * @param paths test paths
     * @param test (optional) for matching
     */
    static collect(paths: string[], test?: (plyee: Plyee) => boolean): Map<string, Plyee[]> {
        const map = new Map<string, Plyee[]>();
        for (const path of paths) {
            const plyee = new Plyee(path);
            if (!test || test(plyee)) {
                let plyees = map.get(plyee.location);
                if (!plyees) {
                    plyees = [];
                    map.set(plyee.location, plyees);
                }
                plyees.push(plyee);
            }
        }
        return map;
    }
}


/**
 * Utility for executing multiple tests, organized into their respective suites.
 * Used by both CLI and vscode-ply.
 */
export class Plier extends EventEmitter {
    private readonly ply: Ply;
    /**
     * general purpose logger not associated with suite (goes to console)
     */
    readonly logger: Logger;

    get options() { return this.ply.options; }

    constructor(options?: Options) {
        super({ captureRejections: true });

        this.ply = new Ply(options);
        this.logger = new Logger({
            level: this.ply.options.verbose ? LogLevel.debug : (this.ply.options.quiet ? LogLevel.error : LogLevel.info),
            prettyIndent: this.ply.options.prettyIndent
        });
    }

    /**
     * Plyees should be test paths (not suites).
     * TODO: DRY this out
     */
    async run(plyees: string[], runOptions?: RunOptions): Promise<Result[]> {
        this.logger.debug('Options', this.ply.options);

        const plyValues = new Values(this.ply.options.valuesFiles, this.logger);
        const values = await plyValues.read();

        let promises: Promise<Result[]>[] = [];
        let combined: Result[] = [];


        // requests
        const requestTests = new Map<Suite<Request>, string[]>();
        for (const [loc, requestPlyee] of Plyee.requests(plyees)) {
            const tests = requestPlyee.map(plyee => {
                if (!plyee.test) {
                    throw new Error(`Plyee is not a test: ${plyee}`);
                }
                return plyee.test;
            });
            const requestSuite = await this.ply.loadRequestSuite(loc);
            requestSuite.emitter = this;
            requestTests.set(requestSuite, tests);
        }

        const requestRunner = new PlyRunner(this.ply.options, requestTests, plyValues, this.logger);
        await requestRunner.runSuiteTests(values, runOptions);
        if (this.ply.options.parallel) promises = [ ...promises, ...requestRunner.promises ];
        else combined = [ ...combined, ...requestRunner.results ];


        // flows
        const flowTests = new Map<FlowSuite, string[]>();
        for (const [loc, flowPlyee] of Plyee.flows(plyees)) {
            const tests = flowPlyee.map(plyee => {
                if (!plyee.test) {
                    throw new Error(`Plyee is not a test: ${plyee}`);
                }
                return plyee.test;
            });
            const flowSuites = await this.ply.loadFlowSuites(loc);
            for (const flowSuite of flowSuites) {
                // should only be one per loc
                flowSuite.emitter = this;
                flowTests.set(flowSuite, tests);
            }
        }

        const flowRunner = new PlyRunner(this.ply.options, flowTests, plyValues, this.logger);
        await flowRunner.runSuiteTests(values, runOptions);
        if (this.ply.options.parallel) promises = [...promises, ...flowRunner.promises];
        else combined = [...combined, ...flowRunner.results];


        // cases
        const caseTests = new Map<Suite<Case>, string[]>();
        for (const [loc, casePlyee] of Plyee.cases(plyees)) {
            const tests = casePlyee.map(plyee => {
                if (!plyee.test) {
                    throw new Error(`Plyee is not a test: ${plyee}`);
                }
                return plyee.test;
            });
            const caseSuites = await this.ply.loadCaseSuites(loc);
            for (const caseSuite of caseSuites) {
                // should only be one per loc
                caseSuite.emitter = this;
                caseTests.set(caseSuite, tests);
            }
        }

        const caseRunner = new PlyRunner(this.ply.options, caseTests, plyValues, this.logger);
        await caseRunner.runSuiteTests(values, runOptions);
        if (this.ply.options.parallel) promises = [...promises, ...caseRunner.promises];
        else combined = [...combined, ...caseRunner.results];


        if (this.ply.options.parallel) {
            for (const results of await Promise.all(promises)) {
                combined = [...combined, ...results];
            }
        }

        return combined;
    }

    /**
     * Finds plyees from suites and tests.
     * @param paths suite/test paths
     */
    async find(paths: string[]): Promise<string[]> {
        const plyees: string[] = [];
        for (const path of paths) {
            if (path.indexOf('#') > 0) {
                plyees.push(path);
            } else {
                // suite
                if (Plyee.isRequest(path)) {
                    const requestSuite = await this.ply.loadRequestSuite(path);
                    if (!requestSuite.skip) {
                        for (const request of requestSuite) {
                            plyees.push(this.ply.options.testsLocation + '/' + requestSuite.path + '#' + request.name);
                        }
                    }
                } else if (Plyee.isCase(path)) {
                    const caseSuites = await this.ply.loadCaseSuites(path);
                    for (const caseSuite of caseSuites) {
                        if (!caseSuite.skip) {
                            for (const testCase of caseSuite) {
                                plyees.push(this.ply.options.testsLocation + '/' + caseSuite.path + '#' + testCase.name);
                            }
                        }
                    }
                } else if (Plyee.isFlow(path)) {
                    const flowSuites = await this.ply.loadFlowSuites(path);
                    for (const flowSuite of flowSuites) {
                        if (!flowSuite.skip) {
                            for (const step of flowSuite) {
                                plyees.push(this.ply.options.testsLocation + '/' + flowSuite.path + '#' + step.name);
                            }
                        }
                    }
                }
            }
        }
        return plyees;
    }
}
