import { createGadgetClass } from '../shared/gadgetFactory.js';
import { getMRNotes } from './core/getMRNotes.js';
import { getMRNotesDef } from './definitions.js';

export const GetMRNotes = createGadgetClass(getMRNotesDef, async (params) => {
	return getMRNotes(params.projectPath as string, params.mrIid as number);
});
