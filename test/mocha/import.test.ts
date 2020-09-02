import * as assert from 'assert';
import { Retrieval } from '../../src/retrieval';
import { Import } from '../../src/import';
import { Logger } from '../../src/logger';
import { Ply } from '../../src/ply';
import { Request } from '../../src/request';
import { Storage } from '../../src/storage';

describe('Import', () => {

    const root = 'test/mocha/postman/requests';

    it('should import postman requests', async () => {
        const retrieval = new Retrieval('test/mocha/postman/movies.postman_collection.json');
        assert.ok(retrieval.location.ext);
        assert.ok(await retrieval.exists);
        const importer = new Import('postman', root, new Logger(), 2);
        importer.doImport(retrieval);

        const ply = new Ply();
        const topRequests = ply.loadSuiteSync(`${root}/movies.ply.yaml`);
        assert.ok(topRequests);

        const after1935 = topRequests.get('after 1935') as Request;
        assert.equal(after1935.url, '${baseUrl}?year=>1935');
        assert.equal(after1935.method, 'GET');

        const create = topRequests.get('create') as Request;
        assert.equal(create.url, '${baseUrl}');
        assert.equal(create.method, 'POST');
        assert.equal(create.headers['Content-Type'], 'application/json');
        assert.ok(create.body);
        const movie = JSON.parse(create.body);
        assert.equal(movie.title, 'The Case of the Howling Dog');
        assert.equal(movie.year, 1934);

        const moviesRequests = ply.loadSuiteSync(`${root}/movies/actors.ply.yaml`);
        assert.ok(moviesRequests);

        const lugosi = moviesRequests.get('Lugosi') as Request;
        assert.equal(lugosi.url, '${baseUrl}?search=Bela%20Lugosi');
        assert.equal(lugosi.method, 'GET');

        const karloff = moviesRequests.get('Karloff') as Request;
        assert.equal(karloff.url, '${baseUrl}?search=Boris%20Karloff');
        assert.equal(karloff.method, 'GET');

        const greatRequests = ply.loadSuiteSync(`${root}/movies/by rating/great.ply.yaml`);
        assert.ok(greatRequests);

        const greatsOf1931 = greatRequests.get('great movies of 1931') as Request;
        assert.equal(greatsOf1931.url, '${baseUrl}?rating=5&year=1931');
        assert.equal(greatsOf1931.method, 'GET');

        const greatsAfter1935 = greatRequests.get('great movies after 1935') as Request;
        assert.equal(greatsAfter1935.url, '${baseUrl}?rating=5&year=>1935');
        assert.equal(greatsAfter1935.method, 'GET');
    });

    it('should import postman graphql', async () => {
        const retrieval = new Retrieval('test/mocha/postman/github.postman_collection.json');
        assert.ok(retrieval.location.ext);
        assert.ok(await retrieval.exists);
        const importer = new Import('postman', root, new Logger(), 2);
        importer.doImport(retrieval);

        const ply = new Ply();
        const githubRequests = ply.loadSuiteSync(`${root}/github.ply.yaml`);
        assert.ok(githubRequests);

        const repositoryTopicsQuery = githubRequests.get('repositoryTopicsQuery') as Request;
        assert.equal(repositoryTopicsQuery.url, 'https://api.github.com/graphql');
        assert.equal(repositoryTopicsQuery.method, 'POST');
        assert.ok(repositoryTopicsQuery.body);
        const repositoryTopicsQueryBody = JSON.parse(repositoryTopicsQuery.body);
        const repositoryTopicsQueryQuery = repositoryTopicsQueryBody.query;
        assert.ok(repositoryTopicsQueryQuery);

        const repositoryTopicsGraphql = githubRequests.get('repositoryTopicsGraphql') as Request;
        assert.equal(repositoryTopicsGraphql.url, 'https://api.github.com/graphql');
        assert.equal(repositoryTopicsGraphql.method, 'POST');
        assert.ok(repositoryTopicsGraphql.body);
        const repositoryTopicsGraphqlBody = repositoryTopicsGraphql.body;
        assert.equal(repositoryTopicsGraphqlBody, repositoryTopicsQueryQuery);
    });

    it('should import postman values', async () => {
    });

});
