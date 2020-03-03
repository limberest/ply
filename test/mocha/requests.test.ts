import * as assert from 'assert';
import { Options, Config } from '../../src/options';
import { Ply } from '../../src/ply';

describe('Requests', async () => {

    it('loaded from yaml', async () => {
        const options: Options = new Config().options;
        const ply = new Ply(options);
        const suites = await ply.loadRequests([
            'test/ply/requests/movie-queries.ply.yaml',
            'test/ply/requests/movies-api.ply.yaml'
        ]);

        assert.equal(suites.length, 2);
        assert.equal(suites[0].actual.location.path,
            'test/ply/results/actual/requests/movie-queries.ply.yaml');

        console.log("request: " + JSON.stringify(suites[0].children.get('movieById')));
    });
});
