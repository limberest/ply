import * as assert from 'assert';
import { Logger, LogLevel, LogOptions } from '../../src/logger';
import { Storage } from '../../src/storage';
import * as subst from '../../src/subst';

const logger = new Logger({
    ...new LogOptions(),
    level: LogLevel.info
}, new Storage('temp/output.log'));

describe('subst', () => {

    it('ignores unmatched expression lines', () => {
        const values = {
            x: 'foo',
            y: 'bar'
        };
        // note windows newline converted to \n
        const template = 'here is z: ${x.something()},\r\nand here is y: ${y}';
        const res = subst.replace(template, values, logger);
        assert.equal(res, 'here is z: ${x.something()},\nand here is y: bar');
    });

    it('handles result values', () => {
        const values = {
            baseUrl: 'http://localhost:3000/movies',
            __ply_results: {
                moviesByYearAndRating: {
                    response: {
                        body: {
                            movies: [
                                { id: '8f180e68' },
                                { id: 'eec22a97' }
                            ]
                        }
                    }
                }
            }
        };

        const template = '${baseUrl}/${@moviesByYearAndRating.response.body.movies[1].id}';
        const res = subst.replace(template, values, logger);
        assert.equal(res, 'http://localhost:3000/movies/eec22a97');
    });

});