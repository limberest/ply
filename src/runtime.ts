import * as path from 'path';
import * as process from 'process';
import * as minimatch from 'minimatch';
import { Location } from './location';
import { Logger } from './logger';
import { Retrieval } from './retrieval';
import { Storage } from './storage';
import { PlyOptions } from './options';
import { TEST_PREFIX, BEFORE_PREFIX, AFTER_PREFIX, SUITE_PREFIX } from './decorators';
import { TestSuite, TestCase, Before, After } from './decorators';

export class Runtime {

    testsLocation: Location;
    decoratedSuite?: DecoratedSuite;
    values: object = {};

    constructor(
        readonly locale: string,
        readonly options: PlyOptions,
        readonly logger: Logger,
        readonly retrieval: Retrieval,
        readonly expected: Retrieval,
        readonly actual: Storage) {

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