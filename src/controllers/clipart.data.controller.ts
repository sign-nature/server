import { MethodConfig } from '@methodus/server';
import { ClipArtModel } from '../models/clipart.model';
import { AuthMiddleware } from './auth.middleware';
/*start custom*/
import { DataController } from './datacontroller';
/*end custom*/

@MethodConfig('ClipArt', [AuthMiddleware], '/data/Clipart')
export class ClipArt extends DataController {
    constructor() {
        super(new ClipArtModel(), 'ClipArt');
    }
}
