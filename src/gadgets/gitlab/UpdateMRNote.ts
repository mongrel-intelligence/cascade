import { createGadgetClass } from '../shared/gadgetFactory.js';
import { updateMRNote } from './core/updateMRNote.js';
import { updateMRNoteDef } from './definitions.js';

export const UpdateMRNote = createGadgetClass(updateMRNoteDef, async (params) => {
	return updateMRNote(
		params.projectPath as string,
		params.mrIid as number,
		params.noteId as number,
		params.body as string,
	);
});
