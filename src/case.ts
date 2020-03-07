import { TestType, Plyable } from './ply';
import { Suite } from './suite';

export class Case implements Plyable {
    type = 'case' as TestType;
    line = 0;


    constructor(readonly suite: string, readonly name: string, obj: any) {
    }

    async ply() {
        const testFile = '../test/ply/cases/MovieCrud';
        import(testFile).then(mod => {
            console.log("AFTER IMPORT");

        });
    }

}