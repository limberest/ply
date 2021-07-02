import { Options } from './options';
import * as stringify from 'json-stable-stringify';

export interface Status {
    code: number;
    message: string;
}

export interface Response {
    status: Status;
    headers: {[key: string]: string};
    body?: any;
    time?: number;
}

export class PlyResponse implements Response {

    constructor(
        readonly runId: string,
        readonly status: Status,
        readonly headers: {[key: string]: string},
        readonly body?: any,
        readonly time?: number) {
    }

    /**
     * Orders body object keys unless suppressed by options.  Does not substitute values.
     * Response header keys are always lowercase
     * @param runtime runtime context
     * @param wantedHeaders optional name of headers subset to keep
     * @param stringBody body object is stringified
     */
    getResponse(runId: string, options: Options, wantedHeaders?: string[], stringBody = false): PlyResponse {

        const headers: any = {};
        const headerNames = wantedHeaders || Object.keys(this.headers);
        headerNames.forEach(h => {
            headers[h.toLowerCase()] = this.headers[h];
        });

        let body = this.body;
        if (typeof body === 'string' && (body.startsWith('{') || body.startsWith('['))) {
            try {
                body = JSON.parse(body);
            } catch (err) {
                // cannot parse -- body remains string
            }
        }
        if (stringBody && typeof body === 'object') {
            if (options.responseBodySortedKeys) {
                body = stringify(body, { space: ''.padStart(options.prettyIndent || 0, ' ') });
            }
            else {
                body = JSON.stringify(body, null, options.prettyIndent);
            }
        }

        return new PlyResponse(
            runId,
            this.status,
            headers,
            body,
            this.time
        );
    }
}