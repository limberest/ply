import { diff_match_patch as DiffMatchPatch, Diff as DmpDiff } from 'diff-match-patch';
import { CodeLine } from './code';
import { Logger } from './logger';
import * as subst from './subst';
import { lines } from './util';

/**
 * jsdiff object
 */
export type Diff = {
    added?: boolean
    removed?: boolean
    ignored?: boolean
    value: string
    count: number
}

export type Marker = {
    start: number
    end: number
    ignored?: boolean
}

export class Compare {

    constructor(readonly logger: Logger) {}

    /**
     * Diff results always contain \n newlines
     */
    diffLines(expected: string, actual: string, values: object): Diff[] {
        const dmp = new DiffMatchPatch();
        const a = dmp.diff_linesToChars_(expected, actual);
        const lineText1 = a.chars1;
        const lineText2 = a.chars2;
        const lineArray = a.lineArray;
        const dmpDiffs = dmp.diff_main(lineText1, lineText2, false);
        dmp.diff_charsToLines_(dmpDiffs, lineArray);
        const jsDiffs = this.convertToJsDiff(dmpDiffs);
        if (values) {
            return this.markIgnored(jsDiffs, values);
        }
        else {
            return jsDiffs;
        }
    }

    /**
     * Diffs always have \n newlines
     */
    private convertToJsDiff(diffs: DmpDiff[]): Diff[] {
        const jsdiffs: Diff[] = [];
        diffs.forEach(diff => {
            const jsdiff: Diff = {
                value: diff[1].replace(/\r\n/g, '\n'),
                count: lines(diff[1]).length
            };
            if (diff[0] === -1) {
                jsdiff.removed = true;
            }
            else if (diff[0] === 1) {
                jsdiff.added = true;
            }
            if (jsdiff.value.endsWith('\n')) {
                jsdiff.count--;
            }
            jsdiffs.push(jsdiff);
        });
        return jsdiffs;
    }

    /**
     * Handles regex and @request/@response.
     */
    private markIgnored(diffs: Diff[], values: object) {
        for (let i = 0; i < diffs.length; i++) {
            if (diffs[i].removed && diffs.length > i + 1 && diffs[i + 1].added) {
                const exp = subst.replace(diffs[i].value, values, this.logger);
                const act = diffs[i + 1].value;
                if (exp === act) {
                    diffs[i].ignored = diffs[i + 1].ignored = true;
                }
                else if (exp.indexOf('${~') >= 0) {
                    // regex

                    // first escape all parens (TODO: this means regexs cannot contain parens)
                    let regex = exp.replace(/\(/g, '\\(').replace(/\)/g, '\\)');
                    // capture groups for expressions
                    regex = regex.replace(/\$\{~.+?}/g, (match) => {
                        return '(' + match.substr(3, match.length - 4) + ')';
                    });

                    // TODO: this is an ugly way of handling optional fields which otherwise mess up regex match
                    // regex = regex.replace(/\?":/g, '\\?":');
                    
                    const match = act.match(new RegExp(regex));
                    if (match && match[0].length === act.length) {
                        diffs[i].ignored = diffs[i + 1].ignored = true;
                    }
                }
            }
        }
        return diffs;
    }

    /**
     * Used by ply-ui
     */
    mirrorDiffs(diffs: Diff[]): Diff[] {
        const mirroredDiffs = [];
        for (let i = 0; i < diffs.length; i++) {
            const diff = diffs[i];
            if (diff.removed) {
                const correspondingAdd = (i < diffs.length - 1 && diffs[i + 1].added) ? diffs[i + 1] : null;
                if (correspondingAdd) {
                    const remove = Object.assign({}, correspondingAdd);
                    delete remove.added;
                    remove.removed = true;
                    mirroredDiffs.push(remove);
                    i++; // corresponding add already covered
                }
                const add = Object.assign({}, diff);
                delete add.removed;
                add.added = true;
                mirroredDiffs.push(add);
            }
            else if (diff.added) {
                const rem = Object.assign({}, diff);
                delete rem.added;
                rem.removed = true;
                mirroredDiffs.push(rem);
            }
            else {
                mirroredDiffs.push(diff);
            }
        }
        return mirroredDiffs;
    }

    /**
     * Used by ply-ui
     */
    markLines(start: number, lines: string[], ignored: boolean) {
        const markers: Marker[] = [];
        let linesIdx = 0;
        lines.forEach(line => {
            const marker: Marker = {
                start: start + linesIdx,
                end: start + linesIdx + line.length + 1,
            };
            if (ignored) {
                marker.ignored = true;
            }
            markers.push(marker);
            linesIdx += line.length + 1;
        });
        return markers;
    }

    getMarkers(diffs: Diff[], lines: CodeLine[]) {
        const markers: Marker[] = [];
        if (diffs) {
            let idx = 0;
            let lineIdx = 0;
            for (let i = 0; i < diffs.length; i++) {
                const diff = diffs[i];
                if (diff.removed) {
                    const correspondingAdd = (i < diffs.length - 1 && diffs[i + 1].added) ? diffs[i + 1] : null;
                    const oldLines = diff.value.replace(/\n$/, '').split(/\n/);
                    if (correspondingAdd) {
                        // diff each line
                        const newLines = correspondingAdd.value.replace(/\n$/, '').split(/\n/);
                        const dmp = new DiffMatchPatch();
                        for (let j = 0; j < oldLines.length && j < newLines.length; j++) {
                            const dmpLineDiffs = dmp.diff_main(oldLines[j], newLines[j]);
                            dmp.diff_cleanupEfficiency(dmpLineDiffs);
                            const lineDiffs = this.convertToJsDiff(dmpLineDiffs);
                            lineDiffs.forEach(lineDiff => {
                                if (lineDiff.removed) {
                                    const marker: Marker = {
                                        start: idx,
                                        end: idx + lineDiff.value.length,
                                    };
                                    if (diff.ignored) {
                                        marker.ignored = true;
                                    }
                                    markers.push(marker);
                                    idx += lineDiff.value.length;
                                }
                                else if (!lineDiff.added) {
                                    idx += lineDiff.value.length;
                                }
                            });
                            idx++; // newLine
                        }
                        // TODO: handle oldLines > newLines or vice-versa
                    }
                    else {
                        // mark every line
                        markers.push.apply(markers, this.markLines(idx, oldLines, diff.ignored === true));  // eslint-disable-line prefer-spread
                    }

                    if (correspondingAdd) {
                        i++; // corresponding add already covered
                    }

                    // account for ignored comments
                    if (lines && lines[lineIdx].comment) {
                        idx += lines[lineIdx].comment?.length || 0;
                    }
                    lineIdx += diff.count;
                }
                else if (!diff.added) {
                    idx += diff.value.length;
                    // account for ignored comments
                    if (lines && lines[lineIdx].comment) {
                        idx += lines[lineIdx].comment?.length || 0;
                    }
                    lineIdx += diff.count;
                }
            }
        }

        return markers;
    }
}