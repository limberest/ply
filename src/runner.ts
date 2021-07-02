import { Logger } from './logger';
import { PlyOptions, RunOptions } from './options';
import { Result } from './result';
import { Suite } from './suite';
import { Test } from './test';
import { Values } from './values';

/**
 * Runs ply tests per suite
 */
export class PlyRunner<T extends Test> {

    /**
     * Results are for sequential execution
     */
    results: Result[] = [];

    /**
     * Promises are for parallel execution
     */
    promises: Promise<Result[]>[] = [];


    constructor(
        readonly options: PlyOptions,
        readonly suiteTests: Map<Suite<T>, string[]>,
        readonly plyValues: Values,
        private logger: Logger
    ) {

    }

    async runSuiteTests(values: object, runOptions?: RunOptions) {
        if (this.suiteTests.size === 0) return;

        if (this.plyValues.isRows) {
            // iterate rows
            let rowCount = 0; // row count for this batch
            for await (const rowVals of await this.plyValues.getRowStream()) {
                if (rowCount >= this.options.batchRows && this.options.batchDelay > 0) {
                    rowCount = 0;
                    this.logger.info('--------------------');
                    await this.delay(this.options.batchDelay);
                }

                rowCount++;
                for (const [suite, tests] of this.suiteTests) {
                    const promise = suite.run(tests, rowVals, runOptions);
                    if (this.options.parallel) this.promises.push(promise);
                    else this.results = [...this.results, ...(await promise)];
                }
            }
        } else {
            for (const [suite, tests] of this.suiteTests) {
                const promise = suite.run(tests, values, runOptions);
                if (this.options.parallel) this.promises.push(promise);
                else this.results = [...this.results, ...(await promise)];
            }
        }
    }

    private async delay(ms: number) {
        return new Promise(resolve => {
            setTimeout(resolve, ms);
        });
    }
}