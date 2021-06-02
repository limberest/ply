import * as fs from 'fs';
import * as path from 'path';
import * as deepmerge from 'deepmerge';
import * as csv from 'csv-parse';
import readXlsx from 'read-excel-file/node';
import { Retrieval } from './retrieval';
import { Logger } from './logger';

/**
 * Environment variable for additional values
 */
const PLY_VALUES = 'PLY_VALUES';

export class Values {
    constructor(
        private readonly locations: string[],
        private readonly logger: Logger
    ) { }

    async read(): Promise<any> {
        let values = {};
        for (const location of this.locations) {
            const contents = await new Retrieval(location).read();
            if (contents) {
                try {
                    const obj = JSON.parse(contents);
                    values = deepmerge(values, obj);
                } catch (err) {
                    throw new Error(`Cannot parse values file: ${location} (${err.message})`);
                }
            } else {
                this.logger.debug(`Values file not found: ${path.normalize(path.resolve(location))}`);
            }
        }
        this.logger.debug('Values (excluding PLY_VALUES env var)', values);
        const envValues = process.env[PLY_VALUES];
        if (envValues) {
            try {
                const obj = JSON.parse(envValues);
                values = deepmerge(values, obj);
            } catch (err) {
                throw new Error(`Cannot parse ${PLY_VALUES} (${err.message})`);
            }
        }
        return values;
    }
}

export const fromCsv = async (file: string): Promise<any[]> => {

    const valueObjs: any[] = [];

    const parser = fs
        .createReadStream(file)
        .pipe(csv({
            // CSV options if any
        }));

    let converter: RowConverter | undefined;
    for await (const row of parser) {
        if (converter) {
            valueObjs.push(converter.convert(row));
        } else {
            converter = new DefaultRowConverter(row);
        }
    }

    return valueObjs;
};

export const fromXlsx = async (file: string): Promise<any[]> => {
    const valueObjs: any[] = [];

    const rows = await readXlsx(file);
    let converter: RowConverter | undefined;

    for await (const row of rows) {
        if (converter) {
            valueObjs.push(converter.convert(row));
        } else {
            converter = new DefaultRowConverter(row, { inferPrimitiveTypes: false });
        }
    }

    return valueObjs;
};

export interface RowConverter {
    convert(row: any[]): any;
}

export interface ConverterOptions {
    inferPrimitiveTypes: boolean;
    dateFormat?: string; // TODO
}

export class DefaultRowConverter implements RowConverter {

    constructor(
        readonly names: any[],
        readonly options: ConverterOptions = {
            inferPrimitiveTypes: true
        }
    ) { }

    convert(row: any[]) {
        const obj: any = {};
        for (let i = 0; i < row.length; i++) {
            const segs = ('' + this.names[i]).split('.');

            let cur = obj;
            for (let j = 0; j < segs.length; j++) {
                const seg = segs[j];
                let key = seg;
                let arrIdx: number | undefined;
                if (seg.endsWith(']')) {
                    const sq1 = seg.indexOf('[');
                    if (sq1 !== -1) {
                        key = seg.substring(0, sq1);
                        arrIdx = parseInt(seg.substring(sq1 + 1, seg.length - 1));
                    }
                }
                if (j === segs.length - 1) {
                    cur[key] = this.getValue(row[i]);
                } else if (typeof arrIdx === 'number') {
                    if (typeof cur[key] === 'undefined') {
                        cur[key] = [];
                    }
                    if (typeof cur[key][arrIdx] === 'undefined') {
                        cur[key][arrIdx] = {};
                    }
                    cur = cur[key][arrIdx];
                } else {
                    if (typeof cur[key] === 'undefined') {
                        cur[key] = {};
                    }
                    cur = cur[key];
                }
            }
        }
        return obj;
    }

    /**
     * TODO: Date
     */
    getValue(val: string): string | number | boolean | Date {
        if (typeof val === 'string' && this.options.inferPrimitiveTypes) {
            const int = parseInt(val);
            if (!isNaN(int)) return int;
            const float = parseFloat(val);
            if (!isNaN(float)) return float;
            if (val.toLowerCase() === 'true') return true;
            else if (val.toLowerCase() === 'false') return false;
        }
        return val;
    }
}
