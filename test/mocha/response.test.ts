import * as assert from 'assert';
import { Ply } from '../../src';
import { PlyResponse } from '../../src/response';

describe('Response', async () => {

    const options = new Ply().options;

    it('recognizes JSON object body content', async () => {
        const bodyObj = { "foo": "bar" };
        let plyResponse = new PlyResponse(
            '123',
            { code: 200, message: 'OK' },
            {},
            JSON.stringify(bodyObj)
        );
        let response = plyResponse.getResponse('123', options);
        assert.strictEqual(typeof response.body, 'object');
        assert.deepStrictEqual(response.body, bodyObj);

        plyResponse = new PlyResponse(
            '456',
            { code: 200, message: 'OK' },
            {},
            bodyObj
        );
        response = plyResponse.getResponse('456', options, [], true);
        assert.strictEqual(typeof response.body, 'string');
        assert.strictEqual(response.body, JSON.stringify(bodyObj, null, options.prettyIndent));
    });

    it('recognizes JSON array body content', async () => {
        const bodyArr = [ 'foo', 'bar' ];
        let plyResponse = new PlyResponse(
            '789',
            { code: 200, message: 'OK' },
            {},
            JSON.stringify(bodyArr)
        );
        let response = plyResponse.getResponse('789', options);
        assert.strictEqual(Array.isArray(response.body), true);
        assert.deepStrictEqual(response.body, bodyArr);

        plyResponse = new PlyResponse(
            'abc',
            { code: 200, message: 'OK' },
            {},
            bodyArr
        );
        response = plyResponse.getResponse('abc', options, [], true);
        assert.strictEqual(typeof response.body, 'string');
        assert.strictEqual(response.body, JSON.stringify(bodyArr, null, options.prettyIndent));
    });
});
