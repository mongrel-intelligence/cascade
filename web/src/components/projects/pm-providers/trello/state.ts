export interface TrelloBoardOption {
	id: string;
	name: string;
	url: string;
}

export interface TrelloBoardDetails {
	lists: Array<{ id: string; name: string }>;
	labels: Array<{ id: string; name: string; color: string }>;
	customFields: Array<{ id: string; name: string; type: string }>;
}

export interface TrelloWizardStateSlice {
	trelloApiKey: string;
	trelloToken: string;
	trelloBoardId: string;
	trelloBoards: TrelloBoardOption[];
	trelloBoardDetails: TrelloBoardDetails | null;
	trelloListMappings: Record<string, string>;
	trelloLabelMappings: Record<string, string>;
	trelloCostFieldId: string;
}

export function createInitialTrelloState(): TrelloWizardStateSlice {
	return {
		trelloApiKey: '',
		trelloToken: '',
		trelloBoardId: '',
		trelloBoards: [],
		trelloBoardDetails: null,
		trelloListMappings: {},
		trelloLabelMappings: {},
		trelloCostFieldId: '',
	};
}

export function resetTrelloBoardState(
	trelloBoardId: string,
): Pick<
	TrelloWizardStateSlice,
	| 'trelloBoardId'
	| 'trelloBoardDetails'
	| 'trelloListMappings'
	| 'trelloLabelMappings'
	| 'trelloCostFieldId'
> {
	return {
		trelloBoardId,
		trelloBoardDetails: null,
		trelloListMappings: {},
		trelloLabelMappings: {},
		trelloCostFieldId: '',
	};
}
