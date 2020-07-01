import * as path from 'path';
import * as process from 'process';
import * as minimatch from 'minimatch';
import { Location } from './location';
import { Retrieval } from './retrieval';
import { Storage } from './storage';
import { PlyOptions } from './options';
import { TEST_PREFIX, BEFORE_PREFIX, AFTER_PREFIX, SUITE_PREFIX } from './decorators';
import { TestSuite, TestCase, Before, After } from './decorators';
import * as yaml from './yaml';

export class ResultPaths {

    private constructor(
        readonly expected: Retrieval,
        readonly actual: Storage,
        readonly log?: Storage) { }

    /**
     * Figures out locations and file extensions for results.
     * Result file path relative to configured result location is the same as retrieval relative
     * to configured tests location.
     */
    static async create(options: PlyOptions, suiteName: string, retrieval: Retrieval): Promise<ResultPaths> {

        let expectedPath;
        let actualPath;
        let log;

        if (retrieval.location.isChildOf(options.testsLocation)) {
            const relPath = retrieval.location.relativeTo(options.testsLocation);
            const resultFilePath = new Location(relPath).parent + '/' + suiteName;
            expectedPath = options.expectedLocation + '/' + resultFilePath;
            actualPath = options.actualLocation + '/' + resultFilePath;
            if (options.logLocation) {
                log = new Storage(options.logLocation + '/' + resultFilePath + '.log');
            }
        }
        else {
            // can't determine results relative path; use specified
            expectedPath = options.expectedLocation + '/' + suiteName;
            actualPath = options.actualLocation + '/' + suiteName;
            if (options.logLocation) {
                log = new Storage(options.logLocation + '/' + suiteName + '.log');
            }
        }

        let ext = '.yml';
        if (!await new Retrieval(expectedPath + '.yml').exists) {
            if (await new Retrieval(expectedPath + '.yaml').exists || retrieval.location.ext === '.yaml') {
                ext = '.yaml';
            }
        }
        const expected = new Retrieval(expectedPath + ext);
        const actual = new Storage(actualPath + ext);
        return new ResultPaths(expected, actual, log);
    }

    async getExpectedYaml(name: string): Promise<string> {
        const expected = await this.expected.read();
        if (!expected) {
            throw new Error(`Expected result file not found: ${this.expected}`);
        }
        const expectedObj = yaml.load(this.expected.toString(), expected, true)[name];
        if (!expectedObj) {
            throw new Error(`Expected result not found: ${this.expected}#${name}`);
        }
        const expectedLines = expected.split(/\r?\n/);
        return expectedLines.slice(expectedObj.__start, expectedObj.__end + 1).join('\n');
    }

    getActualYaml(name: string): string {
        const actual = this.actual.read();
        if (!actual) {
            throw new Error(`Actual result file not found: ${this.actual}`);
        }
        const actualObj = yaml.load(this.actual.toString(), actual, true)[name];
        if (!actualObj) {
            throw new Error(`Actual result not found: ${this.actual}#${name}`);
        }
        const actualLines = actual.split(/\r?\n/);
        return actualLines.slice(actualObj.__start, actualObj.__end + 1).join('\n');
    }
}

export type CallingCaseInfo = {
    results: ResultPaths,
    suiteName: string,
    caseName: string
};

/**
 * Runtime information for a test suite.
 */
export class Runtime {

    testsLocation: Location;

    decoratedSuite?: DecoratedSuite;
    values: object = {};

    constructor(
        readonly locale: string,
        readonly options: PlyOptions,
        readonly retrieval: Retrieval,
        public results: ResultPaths) {

        if (path.isAbsolute(this.options.testsLocation)) {
            this.testsLocation = new Location(this.options.testsLocation);
        }
        else {
            this.testsLocation = new Location(path.resolve(process.cwd() + '/' + this.options.testsLocation));
        }
    }

    get suitePath(): string {
        return this.retrieval.location.relativeTo(this.options.testsLocation);
    }
}

/**
 * Applicable for Cases (and soon Workflows)
 */
export class DecoratedSuite {

    readonly testSuite: TestSuite;
    readonly testCases: TestCase[] = [];
    readonly befores: Before[] = [];
    readonly afters: After[] = [];

    /**
     * @param instance runtime instance of a suite
     */
    constructor(readonly instance: any) {
        this.testSuite = instance.constructor[SUITE_PREFIX];
        if (this.testSuite) {
            this.testSuite = { ...this.testSuite, className: this.testSuite.name };
        }
        Object.getOwnPropertyNames(instance.constructor.prototype).forEach(propName => {
            try {
                if (typeof instance.constructor.prototype[propName] === 'function') {
                    const method = instance.constructor.prototype[propName];
                    if (method[TEST_PREFIX]) {
                        let testCase = method[TEST_PREFIX];
                        if (!this.testCases.find(tc => tc.name === testCase.name)) {
                            this.testCases.push({ ...testCase, method });
                        }
                    }
                    if (method[BEFORE_PREFIX]) {
                        let before = method[BEFORE_PREFIX];
                        if (!this.befores.find(b => b.name === before.name)) {
                            this.befores.push({ ...before, method });
                        }
                    }
                    if (method[AFTER_PREFIX]) {
                        let after = method[AFTER_PREFIX];
                        if (!this.afters.find(a => a.name === after.name)) {
                            this.afters.push({ ...after, method });
                        }
                    }
                }
            }
            catch (_ignored) {
                // getter or setter before constructor?
            }
        });
    }

    private async runIfMatch(beforeOrAfter: Before | After, test: string, values: object) {
        if (this.isMatch(beforeOrAfter, test)) {
            if (beforeOrAfter.tests || !beforeOrAfter.hasRun) {
                await beforeOrAfter.method.call(this.instance, values);
                beforeOrAfter.hasRun = true;
            }
        }
    }

    private isMatch(beforeOrAfter: Before | After, test: string) {
        return !beforeOrAfter.tests || minimatch(test, beforeOrAfter.tests);
    }

    async runBefores(test: string, values: object) {
        for (const before of this.befores) {
            await this.runIfMatch(before, test, values);
        }
    }

    async runAfters(test: string, values: object) {
        for (const after of this.afters) {
            await this.runIfMatch(after, test, values);
        }
    }
}