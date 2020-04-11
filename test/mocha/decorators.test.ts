import * as assert from 'assert';
import ply from '../../src/index';
import { UnnamedSuite, NamedSuite } from './suites';
import { DecoratedSuite } from '../../src/suite';

describe('Decorators', async () => {

    it('reads unnamed @suite', async () => {

        let unnamed = new UnnamedSuite();
        let decorated = new DecoratedSuite(unnamed);
        assert.equal(decorated.testSuite.name, 'UnnamedSuite');
        assert.equal(decorated.befores.length, 1);
        assert.equal(decorated.befores[0].name, 'beforeAll');
        assert.ok(!decorated.befores[0].tests);

        let testCases = decorated.testCases;
        assert.equal(testCases.length, 2);
        assert.equal(testCases[0].name, 'unnamedCaseNoValues');
        assert.equal(testCases[1].name, 'unnamedCaseWithValues');

        assert.equal(decorated.afters.length, 1);
        assert.equal(decorated.afters[0].name, 'afterAll');
        assert.ok(!decorated.afters[0].tests);
    });

    it('reads named @suite', async () => {

        let named = new NamedSuite();
        let decorated = new DecoratedSuite(named);
        assert.equal(decorated.testSuite.name, 'my suite name');
        assert.equal(decorated.befores.length, 2);
        assert.equal(decorated.befores[0].name, 'beforeAll');
        assert.ok(!decorated.befores[0].tests);
        assert.equal(decorated.befores[1].name, 'beforeEach');
        assert.equal(decorated.befores[1].tests, '*');

        let testCases = decorated.testCases;
        assert.equal(testCases.length, 2);
        assert.equal(testCases[0].name, 'first case');
        assert.equal(testCases[0].method.name, 'namedCaseNoValues');
        assert.equal(testCases[1].name, 'second case');
        assert.equal(testCases[1].method.name, 'namedCaseWithValues');

        assert.equal(decorated.afters.length, 2);
        assert.equal(decorated.afters[0].name, 'afterEach');
        assert.equal(decorated.afters[0].tests, '*');
        assert.equal(decorated.afters[1].name, 'afterAll');
        assert.ok(!decorated.afters[1].tests);
    });

    it('loads suites from ts', async () => {
        const suites = await ply.loadCases('test/mocha/suites.ts');
        assert.equal(suites.length, 2);

        assert.equal(suites[0].name, 'UnnamedSuite');
        assert.equal(suites[0].startLine, 4);
        assert.equal(suites[0].endLine, 30);
        const unnamedTests = suites[0].tests;
        assert.equal(Object.keys(unnamedTests).length, 2);
        const unnamedCaseNoValues = suites[0].tests['unnamedCaseNoValues'];
        assert.equal(unnamedCaseNoValues.name, 'unnamedCaseNoValues');
        assert.equal(unnamedCaseNoValues.suiteClass, 'UnnamedSuite');
        assert.equal(unnamedCaseNoValues.method, 'unnamedCaseNoValues');
        assert.equal(unnamedCaseNoValues.startLine, 16);
        assert.equal(unnamedCaseNoValues.endLine, 19);
        const unnamedCaseWithValues = suites[0].tests['unnamedCaseWithValues'];
        assert.equal(unnamedCaseWithValues.name, 'unnamedCaseWithValues');
        assert.equal(unnamedCaseWithValues.suiteClass, 'UnnamedSuite');
        assert.equal(unnamedCaseWithValues.method, 'unnamedCaseWithValues');

        assert.equal(suites[1].name, 'my suite name');
        assert.equal(suites[1].startLine, 32);
        assert.equal(suites[1].endLine, 68);
        const namedCaseNoValues = suites[1].tests['first case'];
        assert.equal(namedCaseNoValues.name, 'first case');
        assert.equal(namedCaseNoValues.suiteClass, 'NamedSuite');
        assert.equal(namedCaseNoValues.method, 'namedCaseNoValues');
        assert.equal(namedCaseNoValues.startLine, 49);
        assert.equal(namedCaseNoValues.endLine, 52);
        const namedCaseWithValues = suites[1].tests['second case'];
        assert.equal(namedCaseWithValues.name, 'second case');
        assert.equal(namedCaseWithValues.suiteClass, 'NamedSuite');
        assert.equal(namedCaseWithValues.method, 'namedCaseWithValues');
        console.log("DONE");
    });

});
