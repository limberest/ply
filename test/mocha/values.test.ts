import * as fs from 'fs';
import * as assert from 'assert';
import { Logger, LogLevel } from '../../src/logger';
import { Config } from '../../src/options';
import { Values, fromXlsx, fromCsv } from '../../src/values';

describe('Values', () => {

    const logger = new Logger({ level: LogLevel.debug, prettyIndent: 2 });
    const options = new Config().options;


    it('should merge files', async () => {
        const locations = [
            'test/ply/values/localhost.json',
            'test/ply/values/global.json',
            'test/mocha/values/a.json',
            'test/mocha/values/b.json'
        ];

        const values = await new Values(locations, logger).read();

        assert.strictEqual(values.baseUrl, 'http://localhost:8080/movies');
        assert.strictEqual(values.year, 2020);
        assert.strictEqual(values.rating, 10);
        assert.strictEqual(values.query, 'year=1935&rating=>4&sort=rating&descending=true');
        const obj = values.obj;
        assert.ok(obj);
        assert.strictEqual(obj.file, 'b.json');
        assert.strictEqual(values.foo, 'bar');
    });

    it('should use config', async () => {

        const values = await new Values(options.valuesFiles, logger).read();

        assert.strictEqual(values.baseUrl, 'http://localhost:3000');
        assert.strictEqual(values.year, 1931);
        assert.strictEqual(values.rating, 5);
        assert.strictEqual(values.query, 'year=1935&rating=>4&sort=rating&descending=true');
    });

    it('should honor PLY_VALUES', async () => {

        const prevValues = process.env.PLY_VALUES;
        process.env.PLY_VALUES = '{ "rating": 1, "baseUrl": "http://localhost/movies" }';
        const values = await new Values(options.valuesFiles, logger).read();
        if (prevValues) {
            process.env.PLY_VALUES = prevValues;
        }

        assert.strictEqual(values.baseUrl, 'http://localhost/movies');
        assert.strictEqual(values.year, 1931);
        assert.strictEqual(values.rating, 1);
        assert.strictEqual(values.query, 'year=1935&rating=>4&sort=rating&descending=true');

    });

    it('should parse csv', async () => {
        const rows = await fromCsv('test/mocha/values/csv.csv');
        assert.strictEqual(rows.length, 2);
        const row0 = JSON.parse(fs.readFileSync('test/mocha/values/csv0.json', 'utf8'));
        assert.deepStrictEqual(rows[0], row0);
        const row1 = JSON.parse(fs.readFileSync('test/mocha/values/csv1.json', 'utf8'));
        assert.deepStrictEqual(rows[1], row1);
    });

    it('should stream csv', async () => {
        const values = new Values([...options.valuesFiles, 'test/mocha/values/movies.csv'], logger);

        const rowValues = [];
        for await (const rowVals of await values.getRowStream()) {
            rowValues.push(rowVals);
        }

        assert.strictEqual(rowValues.length, 3);
        assert.strictEqual(rowValues[1].year, 1934);
        assert.strictEqual(rowValues[1].rating, 4);
        assert.strictEqual(rowValues[1].title, 'The Case of the Howling Dog');
        assert.strictEqual(rowValues[1].description, undefined);
        assert.strictEqual(rowValues[1].credits.length, 6);
        assert.strictEqual(rowValues[1].credits[0].name, 'Alan Crosland');
        assert.strictEqual(rowValues[1].credits[0].role, 'director');
        // global value
        assert.strictEqual(rowValues[1].query, 'year=1935&rating=>4&sort=rating&descending=true');
    });

    it('should read from xlsx', async () => {
        const rows = await fromXlsx('test/mocha/values/xlsx.xlsx');
        assert.strictEqual(rows.length, 2);
        const row0 = JSON.parse(fs.readFileSync('test/mocha/values/csv0.json', 'utf8'));
        assert.deepStrictEqual(rows[0], row0);
        const row1 = JSON.parse(fs.readFileSync('test/mocha/values/csv1.json', 'utf8'));
        assert.deepStrictEqual(rows[1], row1);
    });

    it('should stream xlsx', async () => {
        const values = new Values([...options.valuesFiles, 'test/mocha/values/movies.xlsx'], logger);

        const rowValues = [];
        for await (const rowVals of await values.getRowStream()) {
            rowValues.push(rowVals);
        }

        assert.strictEqual(rowValues.length, 3);
        assert.strictEqual(rowValues[1].year, 1934);
        assert.strictEqual(rowValues[1].rating, 4);
        assert.strictEqual(rowValues[1].title, 'The Case of the Howling Dog');
        assert.strictEqual(rowValues[1].description, null);
        // global value
        assert.strictEqual(rowValues[1].query, 'year=1935&rating=>4&sort=rating&descending=true');
    });
});
