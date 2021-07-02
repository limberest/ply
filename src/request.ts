import fetch from 'cross-fetch';
import { TestType, Test, PlyTest } from './test';
import { Response, PlyResponse } from './response';
import { Logger, LogLevel } from './logger';
import { Retrieval } from './retrieval';
import { Runtime } from './runtime';
import { Options, RunOptions } from './options';
import { PlyResult } from './result';
import { MultipartForm } from './form';
import * as util from './util';
import * as subst from './subst';
import { RUN_ID } from './names';

export interface Request extends Test {
    url: string;
    method: string;
    headers: {[key: string]: string};
    body?: string;
    submitted?: Date;
    submit(values: object): Promise<Response>;
}

export class PlyRequest implements Request, PlyTest {
    readonly type = 'request' as TestType;
    readonly url: string;
    readonly method: string;
    readonly headers: {[key: string]: string};
    readonly body?: string;
    readonly start?: number;
    readonly end?: number;
    submitted?: Date;
    graphQl?: string; // retain substituted but unjsonified query

    /**
     * @param name test name
     * @param obj object to parse for contents
     */
    constructor(readonly name: string, obj: Request, readonly logger: Logger, retrieval: Retrieval) {
        if (!obj.url) {
            throw new Error(`Request ${name} in ${retrieval} is missing 'url'`);
        }
        this.url = obj.url.trim();
        if (!obj.method) {
            throw new Error(`Request ${name} in ${retrieval} is missing 'method'`);
        }
        this.method = obj.method.trim();
        this.headers = obj.headers || {};
        this.body = obj.body;
        this.start = obj.start || 0;
        this.end = obj.end;
    }

    getSupportedMethod(method: string): string | undefined {
        const upperCase = method.toUpperCase().trim();
        if (upperCase === 'GET'
              || upperCase === 'HEAD'
              || upperCase === 'POST'
              || upperCase === 'PUT'
              || upperCase === 'DELETE'
              || upperCase === 'CONNECT'
              || upperCase === 'OPTIONS'
              || upperCase === 'TRACE'
              || upperCase === 'PATCH') {
            return upperCase;
        }
    }

    get isGraphQl(): boolean {
        if (this.body) {
            return this.body.startsWith('query')
              || this.body.startsWith('mutation');
        }
        return false;
    }

    getRunId(values: any): string {
        return values[RUN_ID];
    }

    /**
     * Call submit() to send the request without producing actual results
     * or comparing with expected.  Useful for cleaning up or restoring
     * REST resources before/after testing (see Case.before()/after()).
     */
    async submit(values: object, options?: Options, runOptions?: RunOptions): Promise<Response> {
        return await this.doSubmit(this.getRunId(values), this.getRequest(values, options, true), runOptions);
    }

    private async doSubmit(runId: string, requestObj: Request, runOptions?: RunOptions): Promise<PlyResponse> {
        const logLevel = runOptions?.submit ? LogLevel.info : LogLevel.debug;

        const before = new Date().getTime();
        const { Authorization: _auth, ...loggedHeaders } = requestObj.headers;
        const loggedRequest = { ...requestObj, runId, headers: loggedHeaders };
        this.logger.log(logLevel, 'Request', loggedRequest);

        const ctHeader = util.header(requestObj.headers, 'content-type');
        if (ctHeader && ctHeader[1].startsWith('multipart/form-data')) {
            requestObj = new MultipartForm(requestObj).getRequest();
        }

        const { url: _url, ...fetchRequest } = requestObj;
        const response = await fetch(requestObj.url, fetchRequest);
        const status = { code: response.status, message: response.statusText };
        const headers = this.responseHeaders(response.headers);
        const body = await response.text();
        const time = new Date().getTime() - before;
        const plyResponse = new PlyResponse(runId, status, headers, body, time);
        this.logger.log(logLevel, 'Response', plyResponse);
        return plyResponse;
    }

    /**
     * Request object with substituted values
     */
    getRequest(values: object, options?: Options, includeAuthHeader = false): Request {
        const url = subst.replace(this.url, values, this.logger);
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            throw new Error('Invalid url: ' + url);
        }
        const method = subst.replace(this.method, values, this.logger).toUpperCase();
        if (!this.getSupportedMethod(method)) {
            throw new Error('Unsupported method: ' + method);
        }
        const headers: {[key: string]: string} = {};
        for (const key of Object.keys(this.headers)) {
            headers[key] = subst.replace(this.headers[key], values, this.logger);
        }
        if (!includeAuthHeader) {
            delete headers.Authorization;
        }

        let body = this.body;
        if (body) {
            body = subst.replace(body, values, this.logger);
            if (this.isGraphQl) {
                // graphql
                this.graphQl = body;
                body = JSON.stringify({ query: body }, null, options?.prettyIndent);
            }
        }

        return {
            name: this.name,
            type: this.type,
            url,
            method,
            headers,
            body,
            submitted: this.submitted,
            submit: () => { throw new Error('Not implemented'); }
         };
    }

    private responseHeaders(headers: Headers): {[key: string]: string} {
        const obj: any = {};
        headers.forEach((value, name) => {
            obj[name] = value;
        });
        return obj;
    }

    /**
     * Only to be called in the context of a Suite (hence 'runtime').
     * To execute a test programmatically, call one of the Suite.run() overloads.
     * Or to send a request without testing, call submit().
     * @returns result with request invocation and status of 'Pending'
     */
    async run(runtime: Runtime, values: object, runOptions?: RunOptions): Promise<PlyResult> {
        this.submitted = new Date();
        const requestObject = this.getRequest(values, runtime.options, true);
        const id = this.logger.level === LogLevel.debug ? ` (${this.getRunId(values)})` : '';
        this.logger.info(`Request '${this.name}'${id} submitted at ${util.timestamp(this.submitted, this.logger.level === LogLevel.debug)}`);
        const runOpts: RunOptions = { ...runOptions };
        const expectedExists = await runtime.results.expected.exists;
        if (runOptions?.submitIfExpectedMissing && !expectedExists) {
            runOpts.submit = true;
        }
        const runId = this.getRunId(values);
        const response = await this.doSubmit(runId, requestObject, runOpts);
        if (response.headers && (runOptions?.createExpected || runOptions?.createExpectedIfMissing && !expectedExists) && runtime.options.genExcludeResponseHeaders?.length) {
            for (const key of Object.keys(response.headers)) {
                if (runtime.options.genExcludeResponseHeaders.includes(key)) {
                    delete response.headers[key];
                }
            }
        }
        const result = new PlyResult(
            this.name,
            requestObject,
            response.getResponse(runId, runtime.options, runtime.responseHeaders, true)
        );
        if (this.graphQl) {
            result.graphQl = this.graphQl;
        }
        return result;
    }
}