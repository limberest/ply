import * as findUp from 'find-up';
import * as yargs from 'yargs';
import { Retrieval } from './retrieval';
import * as yaml from './yaml';

/**
 * Ply options.  Empty values are populated with Defaults.
 */
export interface Options {
    /**
     * Tests base directory ('.').
     */
    testsLocation?: string;
    /**
     * Request files glob pattern, relative to testsLocation ('**\/*.{ply.yaml,ply.yml}').
     */
    requestFiles?: string;
    /**
     * Case files glob pattern, relative to testsLocation ('**\/*.ply.ts').
     */
    caseFiles?: string;
    /**
     * Flow files glob pattern, relative to testsLocation ('**\/*.ply.flow').
     */
    flowFiles?: string;
    /**
     * File pattern to ignore, relative to testsLocation ('**\/{node_modules,bin,dist,out}\/**').
     */
    ignore?: string;
    /**
     * File pattern for requests/cases/flows that shouldn't be directly executed, relative to testsLocation.
     */
    skip?: string;
    /**
     * Expected results base dir (testsLocation + '/results/expected').
     */
    expectedLocation?: string;
    /**
     * Actual results base dir (this.testsLocation + '/results/actual').
     */
    actualLocation?: string;
    /**
     * Result files live under a similar subpath as request/case files (true).
     * (eg: Expected result relative to 'expectedLocation' is the same as
     * request file relative to 'testsLocation').
     */
    resultFollowsRelativePath?: boolean;
    /**
     * Log file base dir (this.actualLocation).
     */
    logLocation?: string;
    /**
     * Files containing values JSON.
     */
    valuesFiles?: string[];
    /**
     * Verbose output (false). Takes precedence over 'quiet' if both are true.
     */
    verbose?: boolean;
    /**
     * The opposite of 'verbose' (false).
     */
    quiet?: boolean;
    /**
     * Bail on first failure (false).
     */
    bail?: boolean;
    /**
     * Predictable ordering of response body JSON property keys -- needed for verification (true).
     */
    responseBodySortedKeys?: boolean;
    /**
     * Prettification indent for yaml and response body (2).
     */
    prettyIndent?: number;
}

/**
 * Populated ply options.
 */
export interface PlyOptions extends Options {
    testsLocation: string;
    requestFiles: string;
    caseFiles: string;
    flowFiles: string;
    ignore: string;
    skip: string;
    expectedLocation: string;
    actualLocation: string;
    resultFollowsRelativePath: boolean;
    logLocation: string;
    valuesFiles: string[];
    verbose: boolean;
    quiet: boolean;
    bail: boolean;
    responseBodySortedKeys: boolean;
    prettyIndent: number;
    args?: any;
    runOptions?: RunOptions;
}

/**
 * Options specified on a per-run basis.
 */
export interface RunOptions {
    /**
     * Run test requests but don't verify outcomes.
     */
    submit?: boolean
    /**
     * Skip verify only if expected result does not exist.
     */
    submitIfExpectedMissing?: boolean
    /**
     * Create expected from actual and verify based on that.
     */
    createExpected?: boolean
    /**
     * Create expected from actual only if expected does not exist.
     */
    createExpectedIfMissing?: boolean
    /**
     * Import requests or values from external format (currently 'postman' is supported).
     * Overwrites existing same-named files.
     */
    import?: string;
    /**
     * Import case suite modules from generated .js instead of .ts source (default = false).
     * This runOption needs to be set in your case's calls to Suite.run (for requests),
     * and also in originating the call to Suite.run (for the case(s)).
     */
    useDist?: boolean
}

/**
 * Locations are lazily inited to reflect bootstrapped testsLocation.
 */
export class Defaults implements PlyOptions {
    private _expectedLocation?: string;
    private _actualLocation?: string;
    private _logLocation?: string;
    constructor(readonly testsLocation: string = '.') {}
    requestFiles = '**/*.{ply.yaml,ply.yml}';
    caseFiles = '**/*.ply.ts';
    flowFiles = '**/*.ply.flow';
    ignore = '**/{node_modules,bin,dist,out}/**';
    skip = '';
    get expectedLocation() {
        if (!this._expectedLocation) {
            this._expectedLocation = this.testsLocation + '/results/expected';
        }
        return this._expectedLocation;
    }
    get actualLocation() {
        if (!this._actualLocation) {
            this._actualLocation = this.testsLocation + '/results/actual';
        }
        return this._actualLocation;
    }
    get logLocation() {
        if (!this._logLocation) {
            this._logLocation = this.actualLocation;
        }
        return this._logLocation;
    }
    resultFollowsRelativePath = true;
    valuesFiles = [];
    verbose = false;
    quiet = false;
    bail = false;
    responseBodySortedKeys = true;
    prettyIndent = 2;
}

export const PLY_CONFIGS = ['plyconfig.yaml', 'plyconfig.yml', 'plyconfig.json'];

export class Config {

    public options: PlyOptions;

    private yargsOptions: any = {
        testsLocation: {
            describe: 'Tests base directory',
            alias: 't'
        },
        requestFiles: {
            describe: 'Request files glob pattern',
            alias: 'r'
        },
        caseFiles: {
            describe: 'Case files glob pattern',
            alias: 'c'
        },
        flowFiles: {
            describe: 'Flow files glob pattern',
            alias: 'f'
        },
        ignore: {
            describe: 'File patterns to ignore'
        },
        skip: {
            describe: 'File patterns to skip'
        },
        submit: {
            describe: 'Send requests but don\'t verify results',
            alias: 's',
            type: 'boolean'
        },
        expectedLocation: {
            describe: 'Expected results base dir',
            type: 'string' // avoid premature reading of default
        },
        actualLocation: {
            describe: 'Actual results base dir',
            type: 'string' // avoid premature reading of default
        },
        resultFollowsRelativePath: {
            describe: 'Results under similar subpath'
        },
        logLocation: {
            describe: 'Test logs base dir',
            type: 'string' // avoid premature reading of default
        },
        valuesFiles: {
            describe: 'Values files (comma-separated)',
            type: 'string'
        },
        verbose: {
            describe: 'Much output (supersedes \'quiet\')'
        },
        quiet: {
            describe: 'Opposite of \'verbose\''
        },
        bail: {
            describe: 'Stop on first failure'
        },
        import: {
            describe: 'Import requests/values from (\'postman\')',
            alias: 'i',
            type: 'string'
        },
        create: {
            describe: 'Create expected result from actual',
            type: 'boolean'
        },
        useDist: {
            describe: 'Load cases from dist instead of source',
            type: 'boolean'
        },
        responseBodySortedKeys: {
            describe: 'Sort response body JSON keys'
        },
        prettyIndent: {
            describe: 'Format response JSON'
        }
    };

    constructor(private readonly defaults: PlyOptions = new Defaults(), commandLine = false, configPath?: string) {
        this.options = this.load(defaults, commandLine, configPath);
        this.defaults.testsLocation = this.options.testsLocation;
        // result locations may need priming
        if (!this.options.expectedLocation) {
            this.options.expectedLocation = defaults.expectedLocation;
        }
        if (!this.options.actualLocation) {
            this.options.actualLocation = defaults.actualLocation;
        }
        if (!this.options.logLocation) {
            this.options.logLocation = this.options.actualLocation;
        }
    }

    private load(defaults: PlyOptions, commandLine: boolean, configPath?: string) : PlyOptions {
        let opts: any;
        if (commandLine) {
            // TODO config passed on command line
            if (!configPath && yargs.argv.config) {
                configPath = '' + yargs.argv.config;
                console.debug(`Loading config from ${configPath}`);
            }
            if (!configPath) {
                configPath = findUp.sync(PLY_CONFIGS, { cwd: defaults.testsLocation });
            }
            const config = configPath ? this.read(configPath) : {};
            let spec = yargs
                .config(config)
                .usage('Usage: $0 <tests> [options]')
                .help('help').alias('help', 'h')
                .option('config', { description: 'Ply config location', type: 'string', alias: 'c' })
                .alias('version', 'v');
            for (const option of Object.keys(this.yargsOptions)) {
                const yargsOption = this.yargsOptions[option];
                let type = yargsOption.type;
                if (!type) {
                    // infer from default
                    type = typeof (defaults as any)[option];
                }
                spec = spec.option(option, {
                    type,
                    // default: val, // clutters help output
                    ...yargsOption
                });
                if (type === 'boolean') {
                    spec = spec.boolean(option);
                }
            }
            opts = spec.argv;
            if (typeof opts.valuesFiles === 'string') {
                opts.valuesFiles = opts.valuesFiles.split(',').map((v: string) => v.trim());
            }
            opts.args = opts._;
            delete opts._;
        } else {
            if (!configPath) {
                configPath = findUp.sync(PLY_CONFIGS, { cwd: defaults.testsLocation });
            }
            opts = configPath ? this.read(configPath) : {};
        }
        let options = { ...defaults, ...opts};
        // clean up garbage keys added by yargs, and private defaults
        options = Object.keys(options).reduce((obj: any, key) => {
            if (key.length > 1 && key.indexOf('_') === -1 && key.indexOf('-') === -1) {
                obj[key] = options[key];
            }
            return obj;
        }, {});
        // run options
        options.runOptions = {};
        if (options.submit) {
            options.runOptions.submit = options.submit;
            delete options.submit;
        }
        if (options.create) {
            options.runOptions.createExpected = options.create;
            delete options.create;
        }
        if (options.useDist) {
            options.runOptions.useDist = options.useDist;
            delete options.useDist;
        }
        if (options.import) {
            options.runOptions.import =  options.import;
            delete options.import;
        }

        return options;
    }

    private read(configPath: string): object {
        const retrieval = new Retrieval(configPath);
        const contents = retrieval.sync();
        if (typeof contents === 'string') {
            if (retrieval.location.isYaml) {
                return yaml.load(retrieval.location.path, contents);
            }
            else {
                return JSON.parse(contents);
            }
        }
        else {
            throw new Error("Cannot load config: " + configPath);
        }
    }
}