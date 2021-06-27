import * as assert from 'assert';
import { Ply, Plier } from '../../src/ply';
import { Config } from '../../src/options';
import { Request, PlyRequest } from '../../src/request';
import { Storage } from '../../src/storage';
import { Values } from '../../src/values';
import { MultipartForm } from '../../src/form';

const values = {
    baseUrl: 'http://localhost:3000',
    year: '1931',
    rating: '5',
    query: 'year=1935&rating=>4&sort=rating&descending=true'
};

describe('Requests', async () => {

    beforeEach(() => {
        const missingExpected = new Storage('test/mocha/results/expected/requests/movie-queries.yaml');
        if (missingExpected.exists) {
            missingExpected.remove();
        }
    });

    it('is loaded from yaml', async () => {
        const ply = new Ply();
        const suites = await ply.loadRequests(
            'test/ply/requests/movie-queries.ply.yaml',
            'test/ply/requests/movies-api.ply.yaml'
        );

        assert.strictEqual(suites.length, 2);
        let request = suites[0].get('moviesByYearAndRating') as PlyRequest;
        assert.strictEqual(request.start, 0);
        assert.strictEqual(request.end, 4);

        request = suites[0].get('movieById') as PlyRequest;
        assert.strictEqual(request.name, 'movieById');
        assert.strictEqual(request.method, 'GET');
        const headers = request.headers;
        assert.strictEqual(headers['Accept'], 'application/json');
        assert.strictEqual(request.start, 6);
        assert.strictEqual(request.end, 11);
    });

    it('calculates result subpaths', async () => {
        const ply = new Ply();

        let suite = await ply.loadRequestSuite('test/ply/requests/movie-queries.ply.yaml');
        assert.strictEqual(suite.runtime.results.expected.location.toString(),
            'test/ply/results/expected/requests/movie-queries.yaml');
        assert.strictEqual(suite.runtime.results.actual.location.toString(),
            'test/ply/results/actual/requests/movie-queries.yaml');

        ply.options.resultFollowsRelativePath = false;
        suite = await ply.loadRequestSuite('test/ply/requests/movie-queries.ply.yaml');
        assert.strictEqual(suite.runtime.results.expected.location.toString(),
            'test/ply/results/expected/movie-queries.yaml');
        assert.strictEqual(suite.runtime.results.actual.location.toString(),
            'test/ply/results/actual/movie-queries.yaml');
    });

    it('rejects missing url', async () => {
        const ply = new Ply();
        await assert.rejects(async () => {
            return ply.loadRequests(['test/mocha/requests/bad-requests.ply.yaml']);
        },
        {
            name: 'Error',
            message: "Request missingUrl in test/mocha/requests/bad-requests.ply.yaml is missing 'url'"
        });
    });

    it('can load raw requests', async () => {
        const missive = 'Dear Sir,\n\nGo jump in the "lake".\n\n - A Friend';
        const ply = new Ply();
        const suite = await ply.loadSuite('test/mocha/requests/raw-requests.ply.yaml');

        const rawRequestFlow = suite.get('rawRequestFlow') as Request;
        assert.ok(rawRequestFlow.body);
        const rawRequestFlowBody = JSON.parse(rawRequestFlow.body);
        assert.strictEqual(rawRequestFlowBody.myGreeting, 'Hello');
        assert.strictEqual(rawRequestFlowBody.myNumber, 1234);
        assert.strictEqual(rawRequestFlowBody.myMissive, missive);

        const rawRequestBlock = suite.get('rawRequestBlock') as Request;
        assert.ok(rawRequestBlock.body);
        assert.strictEqual(rawRequestBlock.body, rawRequestFlow.body);
        const rawRequestBlockBody = JSON.parse(rawRequestBlock.body);
        assert.strictEqual(rawRequestBlockBody.myGreeting, 'Hello');
        assert.strictEqual(rawRequestBlockBody.myNumber, 1234);
        assert.strictEqual(rawRequestBlockBody.myMissive, missive);
    });

    it('can handle success', async () => {
        const ply = new Ply();
        const suites = await ply.loadRequests('test/ply/requests/movie-queries.ply.yaml');
        const suite = suites[0];

        const values = {
            baseUrl: "http://localhost:3000",
            year: 1931,
            rating: 5
        };

        const result = await suite.run('moviesByYearAndRating', values);
        assert.strictEqual(result.status, 'Passed');
        assert.strictEqual(result.message, 'Test succeeded');
    });

    it('can handle failure', async () => {
        const ply = new Ply();
        const suites = await ply.loadRequests('test/ply/requests/movie-queries.ply.yaml');
        const suite = suites[0];

        const values = {
            baseUrl: "http://localhost:3000",
            year: 1932,  // instead of 1931
            rating: 5
        };

        const result = await suite.run('moviesByYearAndRating', values);
        assert.strictEqual(result.status, 'Failed');
        assert.strictEqual(result.message, 'Results differ from line 21 (moviesByYearAndRating:19)');
    });

    it('can handle error', async () => {
        const ply = new Ply({
            ...new Config().options,
            expectedLocation: 'test/ply/results/expected-not-exist'
        });
        const suite = (await ply.loadRequests('test/ply/requests/movie-queries.ply.yaml'))[0];
        const result = await suite.run('movieById', values);
        assert.strictEqual(result.status, 'Errored');
    });

    it('can handle graphql', async () => {
        const ply = new Ply();
        const suites = await ply.loadRequests('test/ply/requests/github-api.ply.yaml');
        const suite = suites[0];
        const vals = await new Values(['test/ply/values/global.json'], suite.logger).read();

        const result = await suite.run('repositoryTopicsQuery', vals);
        assert.strictEqual(result.status, 'Passed');
        assert.strictEqual(result.message, 'Test succeeded');
    });

    it('can iterate suite', async () => {
        const ply = new Ply();
        const suites = await ply.loadRequests('test/ply/requests/movie-queries.ply.yaml');
        const suite = suites[0];
        const requests = [];
        for (const request of suite) {
            requests.push(request);
        }
        assert.strictEqual(requests[0].name, 'moviesByYearAndRating');
        assert.strictEqual(requests[1].name, 'movieById');
        assert.strictEqual(requests[2].name, 'moviesQuery');
    });

    it('can run plyee', async () => {
        const plier = new Plier();
        const results = await plier.run(['test/ply/requests/movie-queries.ply.yaml#moviesByYearAndRating'], { values });
        assert.strictEqual(results[0].status, 'Passed');
        assert.strictEqual(results[0].message, 'Test succeeded');
    });

    it('can run plyees', async () => {
        const plier = new Plier();
        const results = await plier.run([
            'test/ply/requests/movie-queries.ply.yaml#moviesByYearAndRating',
            'test/ply/requests/movie-queries.ply.yaml#movieById',
            'test/ply/requests/movie-queries.ply.yaml#moviesQuery'
          ], { values });
        assert.strictEqual(results[0].status, 'Passed');
        assert.strictEqual(results[0].message, 'Test succeeded');
        assert.strictEqual(results[1].status, 'Passed');
        assert.strictEqual(results[1].message, 'Test succeeded');
        assert.strictEqual(results[2].status, 'Passed');
        assert.strictEqual(results[2].message, 'Test succeeded');
    });

    it('can run suite', async () => {
        const ply = new Ply();
        const suites = await ply.loadRequests('test/ply/requests/movie-queries.ply.yaml');
        const suite = suites[0];
        const results = await suite.run(values);

        assert.strictEqual(results[0].status, 'Passed');
        assert.strictEqual(results[1].status, 'Passed');
        assert.strictEqual(results[2].status, 'Passed');
    });

    it('honors submit', async () => {
        const ply = new Ply({
            ...new Config().options,
            // expected results don't live here
            expectedLocation: 'test/mocha/results/expected',
            actualLocation: 'test/mocha/results/actual'
        });

        const suites = await ply.loadRequests('test/ply/requests/movie-queries.ply.yaml');
        const suite = suites[0];
        const runOptions = { submit: true };
        const results = await suite.run(values, runOptions);

        assert.strictEqual(results[0].status, 'Submitted');
        assert.strictEqual(results[1].status, 'Submitted');
        assert.strictEqual(results[2].status, 'Submitted');
    });

    it('honors CreateExpected', async () => {
        const ply = new Ply({
            ...new Config().options,
            // expected results don't live here
            expectedLocation: 'test/mocha/results/expected',
            actualLocation: 'test/mocha/results/actual'
        });

        const suites = await ply.loadRequests('test/ply/requests/movie-queries.ply.yaml');
        const suite = suites[0];
        const runOptions = { createExpected: true };
        const results = await suite.run(values, runOptions);

        assert.strictEqual(results[0].status, 'Passed');
        assert.strictEqual(results[1].status, 'Passed');
        assert.strictEqual(results[2].status, 'Passed');

        const expected = new Storage('test/mocha/results/expected/requests/movie-queries.yaml');
        assert.ok(expected.exists);
    });

    const formDataRequest: Request = {
        name: 'attach',
        type: 'request',
        url: '${baseUrl}/attachments/naked.png',
        method: 'POST',
        headers: {
            Accept: 'application/ json',
            'Content-Type': 'multipart/form-data;boundary="--boundary"'
        },
        body: `--boundary
Content-Disposition: form-data; name="field1"

value1
--boundary
Content-Disposition: form-data; name="field2"; filename="example.txt"

value2
--boundary--
`,
        submit: () => { throw new Error('Not implemented'); }
    };

    it('parses form data', () => {
        const multipartForm = new MultipartForm(formDataRequest);
        const boundary = multipartForm.getBoundary(formDataRequest.headers['Content-Type']);
        assert.strictEqual(boundary, '--boundary');
        const parts = multipartForm.getParts(formDataRequest.body!, boundary);
        assert.strictEqual(parts.length, 2);
        const part1 = parts[0];
        assert.strictEqual(part1.name, 'field1');
        assert.strictEqual(part1.data?.toString(), 'value1');
        const part2 = parts[1];
        assert.strictEqual(part2.name, 'field2');
        assert.strictEqual(part2.data?.toString(), 'value2');
        assert.strictEqual(part2.filename, 'example.txt');

    });

    it('runs tests from csv', async () => {
        const plier = new Plier({
            ...new Config().options,
            expectedLocation: 'test/mocha/results/expected',
            actualLocation: 'test/mocha/results/actual',
            valuesFiles: [
                'test/mocha/values/movies.csv',
                'test/ply/values/localhost.json'
            ]
        });
        const results = await plier.run([
            'test/mocha/requests/row-requests.ply.yaml#createMovie',
            'test/mocha/requests/row-requests.ply.yaml#updateMovie',
            'test/mocha/requests/row-requests.ply.yaml#retrieveMovie',
            'test/mocha/requests/row-requests.ply.yaml#deleteMovie'
        ]);

        // three rows times four requests
        assert.strictEqual(results.length, 12);
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const rem = i % 4;
            if (rem === 0) assert.strictEqual(result.name, 'createMovie');
            else if (rem === 1) assert.strictEqual(result.name, 'updateMovie');
            else if (rem === 2) assert.strictEqual(result.name, 'retrieveMovie');
            else if (rem === 3) assert.strictEqual(result.name, 'deleteMovie');

            assert.strictEqual(result.status, 'Passed');
        }

        assert.strictEqual(results[2].response.body.id, '3492d3d0');
        assert.strictEqual(results[2].response.body.credits[0].name, 'Michael Curtiz');
    });
});
