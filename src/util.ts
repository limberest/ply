import * as process from 'process';
import * as osLocale from 'os-locale';

export function locale() {
    let locale = osLocale.sync();
    if (!locale || locale.toLocaleLowerCase() === 'c') {
        locale = 'en-US';
    }
    return locale;
}

/**
 * turn a date into a timestamp based on the OS locale
 */
export function timestamp(date: Date, withTimeZone = false): string {
    const millis = String(date.getMilliseconds()).padStart(3, '0');
    const tz = withTimeZone ? date.toTimeString().substring(date.toTimeString().indexOf(' ')) : '';
    return `${date.toLocaleString(locale(), { hour12: false })}:${millis}${tz}`;
}

/**
 * time in nanoseconds
 */
export function nanoTime(): number {
    const hrTime = process.hrtime();
    return hrTime[0] * 1000000000 + hrTime[1];
}

export function genId(): string {
    return nanoTime().toString(16);
}

/**
 * Expected format is per timestamp() --
 * TODO: Only works for these two locale formats:
 *     MM/DD/YYYY, HH:mm:ss
 *     DD/MM/YYYY, HH:mm:ss (not tested actually)
 */
export function timeparse(time: string): Date | undefined {

    const parser = /(\d+?)\/(\d+?)\/(\d+?), (\d+?):(\d+?):(\d+?):(\d+?)$/;
    const match = time.match(parser);
    if (match) {
        const formatObj: any = new Intl.DateTimeFormat(locale()).formatToParts(new Date());
        const first = formatObj[Object.keys(formatObj)[0]].type;
        const month = first === 'month' ? 1 : 2;
        const day = month === 1 ? 2 : 1;
        return new Date(
            parseInt(match[3]),         // year
            parseInt(match[month]) - 1, // monthIndex
            parseInt(match[day]),       // day
            parseInt(match[4]),         // hours
            parseInt(match[5]),         // minutes
            parseInt(match[6]),         // seconds
            parseInt(match[7])          // millis
        );
    }
}

/**
 * Remove windows newline characters (\r)
 */
export function newlines(input: string): string {
    return input.replace(/\r/g, '');
}

/**
 * split a string into an array of lines, ignoring escaped
 */
export function lines(input: string): string[] {
    return input.split(/\r?\n/);
}

/**
 * Return the trailing comment portion of a line. Only works with no
 * embedded comment tokens (in string content, etc).
 */
export function lineComment(line: string, token = '#'): string | undefined {
    const hash = line.indexOf(token);
    if (hash >= 0 && hash < line.length - 1) {
        return line.substr(hash + 1).trim();
    }
}

/**
 * substitute a forward slash for all backslashes
 */
export function fwdSlashes(path: string): string {
    return path.replace(/\\/g, '/');
}

export function header(headers: { [key: string]: string }, name: string): [string, string] | undefined {
    const key = name.toLowerCase();
    const match = Object.keys(headers).find(h => h.toLowerCase() === key);
    if (match) return [match, headers[match]];
}

