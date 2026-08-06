import { createGadgetClass } from '../shared/gadgetFactory.js';
import { postMRNote } from './core/postMRNote.js';
import { postMRNoteDef } from './definitions.js';

export const PostMRNote = createGadgetClass(postMRNoteDef, async (params) => {
	return postMRNote(params.projectPath as string, params.mrIid as number, params.body as string);
});
