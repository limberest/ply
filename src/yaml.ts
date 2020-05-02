import * as jsYaml from 'js-yaml';

export function dump(obj: object, indent: number) {
    return jsYaml.safeDump(obj, { noCompatMode: true, skipInvalid: true, indent, lineWidth: -1 });
}

export function load(file: string, contents: string, assignLines = false) {
    const lines: any = {};
    const obj = jsYaml.safeLoad(contents, {
        filename: file,
        listener: function (op, state) {
            if (assignLines && op === 'open' && state.kind === 'scalar') {
                lines[state.result] = state.line;
            }
        }
    });
    if (assignLines) {
        let contentLines = contents.split(/\r?\n/);
        let lastObjProp: any;
        Object.keys(obj).forEach(key => {
            let line = lines[key];
            if (typeof line !== 'undefined' && typeof obj[key] === 'object') {
                let objProp = obj[key];
                objProp.__start = line;
                if (lastObjProp && typeof lastObjProp.__start !== 'undefined' && typeof objProp.__start !== 'undefined') {
                    lastObjProp.__end = getEndLine(contentLines, lastObjProp.__start, objProp.__start - 1);
                }
                lastObjProp = objProp;
            }
        });
        if (lastObjProp && typeof lastObjProp.__start !== 'undefined') {
            lastObjProp.__end = getEndLine(contentLines, lastObjProp.__start);
        }
    }
    return obj;
}

function getEndLine(contentLines: string[], start: number, end: number | undefined = undefined): number {
    const reversedLines = getLines(contentLines, start, end).reverse();
    let endLine = end || (start + reversedLines.length - 1);
    for (let i = 0; i < reversedLines.length; i++) {
        let line = reversedLines[i].trim();
        if (!line || line.startsWith('#')) {
            endLine--;
        }
        else {
            break;
        }
    }
    return endLine;
}

/**
 * Returns content lines where index is between start and end - 1.
 * If end is not supplied, read to end of contentLines array.
 */
function getLines(contentLines: string[], start: number, end ?: number): string[] {
    return contentLines.reduce((lines: string[], line: string, i: number) => {
        if (i >= start && (!end || i <= end)) {
            lines.push(line);
        }
        return lines;
    }, new Array<string>());
}
