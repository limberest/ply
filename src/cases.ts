import * as ts from 'typescript';
import * as osLocale from 'os-locale';
import { PlyOptions } from './options';
import { Location } from './location';
import { Suite } from './suite';
import { Case, PlyCase } from './case';
import { Retrieval } from './retrieval';
import { Storage } from './storage';
import { Logger } from './logger';
import { Runtime } from './runtime';

interface SuiteDecoration {
    name: string;
    classDeclaration: ts.ClassDeclaration;
    className: string;
    // TODO other decorator params
}

interface CaseDecoration {
    name: string;
    methodDeclaration: ts.MethodDeclaration;
    methodName: string;
    // TODO other decorator params
}

export class CaseLoader {

    private program: ts.Program;
    private checker: ts.TypeChecker;

    constructor(sourceFiles: string[], private options: PlyOptions, private logger: Logger, compilerOptions: ts.CompilerOptions) {
        this.program = ts.createProgram(sourceFiles, compilerOptions);
        this.checker = this.program.getTypeChecker();
    }

    async load(): Promise<Suite<Case>[]> {

        const suites: Suite<Case>[] = [];

        for (const sourceFile of this.program.getSourceFiles()) {
            let suiteDecorations = this.findSuites(sourceFile);
            if (suiteDecorations) {
                let retrieval = new Retrieval(sourceFile.fileName);
                const relPath = retrieval.location.relativeTo(this.options.testsLocation);
                const resultFilePath = new Location(relPath).parent + '/' + retrieval.location.base + '.' + retrieval.location.ext;
                const runtime = new Runtime(
                    await osLocale(),
                    this.options,
                    this.logger,
                    retrieval,
                    new Retrieval(this.options.expectedLocation + '/' + resultFilePath),
                    new Storage(this.options.actualLocation + '/' + resultFilePath)
                );

                for (let suiteDecoration of suiteDecorations) {
                    let suite = new Suite<Case>(
                        suiteDecoration.name,
                        'case',
                        relPath,
                        runtime,
                        sourceFile.getLineAndCharacterOfPosition(suiteDecoration.classDeclaration.getStart()).line,
                        sourceFile.getLineAndCharacterOfPosition(suiteDecoration.classDeclaration.getEnd()).line
                    );

                    for (let caseDecoration of this.findCases(suiteDecoration)) {
                        let c = new PlyCase(
                            caseDecoration.name,
                            suiteDecoration.className,
                            caseDecoration.methodName,
                            sourceFile.getLineAndCharacterOfPosition(caseDecoration.methodDeclaration.getStart()).line,
                            sourceFile.getLineAndCharacterOfPosition(caseDecoration.methodDeclaration.getEnd()).line
                        );
                        suite.add(c);
                    }
                    suites.push(suite);
                }
            }
        }

        return suites;
    }

    private findSuites(sourceFile: ts.SourceFile): SuiteDecoration[] {
        let suites: SuiteDecoration[] = [];
        if (!sourceFile.isDeclarationFile) {
            ts.forEachChild(sourceFile, node => {
                if (ts.isClassDeclaration(node) && node.name && this.isExported(node)) {
                    let suiteDecoration = this.findSuiteDecoration(node as ts.ClassDeclaration);
                    if (suiteDecoration) {
                        suites.push(suiteDecoration);
                    }
                }
            });
        }
        return suites;
    }

    private findSuiteDecoration(classDeclaration: ts.ClassDeclaration): SuiteDecoration | undefined {
        let classSymbol = this.checker.getSymbolAtLocation(<ts.Node>classDeclaration.name);
        if (classSymbol && classDeclaration.decorators) {
            for (const decorator of classDeclaration.decorators) {
                if (decorator.expression) {
                    let decoratorSymbol: ts.Symbol | undefined;
                    const firstToken = decorator.expression.getFirstToken();
                    if (firstToken) {
                        decoratorSymbol = this.checker.getSymbolAtLocation(firstToken);
                    }
                    else {
                        decoratorSymbol = this.checker.getSymbolAtLocation(decorator.expression);
                    }
                    if (decoratorSymbol && this.checker.getAliasedSymbol(decoratorSymbol).name === 'suite') {
                        let suiteName = classSymbol.name;
                        if (decorator.expression.getChildCount() >= 3) {
                            // suite name arg
                            const text = decorator.expression.getChildAt(2).getText();
                            suiteName = text.substring(1, text.length - 1);
                        }
                        return {
                            name: suiteName,
                            classDeclaration: classDeclaration,
                            className: classSymbol.name
                        };
                    }
                }
            }
        }
    }

    private findCases(suiteDecoration: SuiteDecoration): CaseDecoration[] {
        const cases: CaseDecoration[] = [];
        suiteDecoration.classDeclaration.forEachChild(node => {
            if (ts.isMethodDeclaration(node) && node.name && !ts.isPrivateIdentifier(node)) {
                let caseDecoration = this.findCaseDecoration(node as ts.MethodDeclaration);
                if (caseDecoration) {
                    cases.push(caseDecoration);
                }
            }
        });
        return cases;
    }

    private findCaseDecoration(methodDeclaration: ts.MethodDeclaration): CaseDecoration | undefined {
        let methodSymbol = this.checker.getSymbolAtLocation(<ts.Node>methodDeclaration.name);
        if (methodSymbol && methodDeclaration.decorators) {
            for (const decorator of methodDeclaration.decorators) {
                if (decorator.expression) {
                    const firstToken = decorator.expression.getFirstToken();
                    if (firstToken) {
                        let decoratorSymbol = this.checker.getSymbolAtLocation(firstToken);
                        if (decoratorSymbol && this.checker.getAliasedSymbol(decoratorSymbol).name === 'test') {
                            if (decorator.expression.getChildCount() >= 3) {
                                const text = decorator.expression.getChildAt(2).getText();
                                return {
                                    name: text.substring(1, text.length - 1),
                                    methodDeclaration: methodDeclaration,
                                    methodName: methodSymbol.name
                                };
                            }
                        }
                    }
                }
            }
        }
    }

    isExported(node: ts.Node): boolean {
        return (
            (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0 ||
            (!!node.parent && node.parent.kind === ts.SyntaxKind.SourceFile)
        );
    }
}