import { TestType, Plyable } from './ply';
import { Location } from './location';

export class Request implements Plyable {
    type = 'request' as TestType;

    url: string;
    method: string;
    headers: any;
    body: string | undefined;
    line: number;

    /**
     *
     * @param suite suite path relative to tests location (forward slashes)
     * @param name test name
     * @param obj object to parse for contents
     */
    constructor(readonly suite: string, readonly name: string, obj: any) {

        this.validate(obj);

        this.url = obj['url'].trim();
        this.method = obj['method'].toUpperCase().trim();
        this.headers = obj['headers'];
        this.body = obj['body'];
        this.line = obj['line'] || 0;
    }

    validate(obj: any) {
        if (!obj) {
            throw new Error("'" + this.path + "' -> Request object is required");
        }
        else if (!obj['url'] || (!obj['url'].startsWith('${') && !(new Location(obj['url']).isUrl))) {
            throw new Error("'" + this.path + "' -> Bad request url: " + obj['url']);
        }
        else if (!(typeof (obj['method']) === 'string') || !this.isSupportedMethod(obj['method'])) {
            throw new Error("'" + this.path + "' -> Bad request method: " + obj['method']);
        }
    }

    get path() {
        return this.suite + '#' + this.name;
    }

    isSupportedMethod(method: string): boolean {
        const upperCase = method.toUpperCase().trim();
        return (upperCase.startsWith('${') && upperCase.endsWith('}'))
            || upperCase === 'GET'
            || upperCase === 'HEAD'
            || upperCase === 'POST'
            || upperCase === 'PUT'
            || upperCase === 'DELETE'
            || upperCase === 'CONNECT'
            || upperCase === 'OPTIONS'
            || upperCase === 'TRACE'
            || upperCase === 'PATCH';
    }
}