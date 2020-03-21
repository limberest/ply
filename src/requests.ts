import { PlyOptions } from './options';
import { Suite } from './suite';
import { Location } from './location';
import { Retrieval } from './retrieval';
import { Request } from './request';
import { Storage } from './storage';
import * as yaml from './yaml';

export class RequestLoader {

    constructor(readonly locations: string[], private options: PlyOptions) {
    }

    async load(): Promise<Suite<Request>[]> {
        const retrievals = this.locations.map(loc => new Retrieval(loc));
        // load request files in parallel
        const promises = retrievals.map(retr => this.loadSuite(retr));
        return Promise.all(promises);
    }

    async loadSuite(retrieval: Retrieval): Promise<Suite<Request>> {

        const contents = await retrieval.read();
        if (!contents) {
            throw new Error('Cannot retrieve: ' + retrieval.location.absolute);
        }

        const relPath = retrieval.location.relativeTo(this.options.testsLocation);
        const resultFilePath = new Location(relPath).parent + '/' + retrieval.location.base + '.' + retrieval.location.ext;

        const suite = new Suite<Request>(
            retrieval.location.base,
            'request',
            relPath,
            retrieval,
            new Retrieval(this.options.expectedLocation + '/' + resultFilePath),
            new Storage(this.options.actualLocation + '/' + resultFilePath)
        );

        const obj = yaml.load(retrieval.location.path, contents);
        let lastRequest: Request | undefined = undefined;
        for (const key of Object.keys(obj)) {
            let request = new Request(suite.path, key, obj[key]);
            if (lastRequest && request.startLine) {
                lastRequest.endLine = await this.getEndLine(retrieval, lastRequest.startLine, request.startLine - 1);
            }
            lastRequest = request;
            suite.add(request);
        }
        if (lastRequest) {
            lastRequest.endLine = await this.getEndLine(retrieval, lastRequest.startLine);
        }


        return suite;
    }

    async getEndLine(retrieval: Retrieval, start: number, end: number | undefined = undefined): Promise<number | undefined> {
        let lines = await retrieval.readLines(start, end);
        if (lines) {
            lines.reverse();
            let endLine = end || (start + lines.length - 1);
            for (let i = 0; i < lines.length; i++) {
                let line = lines[i].trim();
                if (!line || line.startsWith('#')) {
                    endLine--;
                }
                else {
                    break;
                }
            }
            return endLine;
        }
    }
}

export class RequestRunner {

}