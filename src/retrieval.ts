import { Location } from './location';
import { Storage } from './storage';

/**
 * Abstracts retrieval from either URL or {@link Storage}.
 */
export class Retrieval {

    readonly location: Location;

    /**
     * @param location file path or url (backslashes are replaced with slashes)
     */
    constructor(location: string) {
        this.location = new Location(location);
    }

    read(): Promise<string | undefined> {
        if (this.storage) {
            return Promise.resolve(this.storage.read());
        }
        else {
            return this.fetch(this.location.path)
            .then((response: Response) => {
                return response.text();
            });
        }
    }

    sync(): string | undefined {
        if (this.storage) {
            return this.storage.read();
        }
        else {
            throw new Error('Retrieval.sync() not supported for remote path: ' + this);
        }
    }

    get exists(): Promise<boolean> {
        if (this.storage) {
            return Promise.resolve(this.storage.exists);
        }
        else {
            try {
                return this.fetch(this.location.path, { method: 'HEAD' })
                .then((response: Response) => {
                    return Promise.resolve(response.ok);
                });
            } catch {
                return Promise.resolve(false);
            }
        }
    }

    toString(): string {
        return this.location.toString();
    }

    get storage(): Storage | undefined {
        if (!this.location.isUrl) {
            return new Storage(this.location.path);
        }
    }

    get fetch(): any {
        if (this.location.isUrl) {
            if (typeof window === 'undefined') {
                return require('node-fetch');
            }
            else {
                return window.fetch;
            }
        }
    }
}