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

interface VerificationState {
	verificationResult: { provider: string; display: string } | null;
	verifyError: string | null;
}

export type TrelloWizardAction =
	| { type: 'SET_TRELLO_API_KEY'; value: string }
	| { type: 'SET_TRELLO_TOKEN'; value: string }
	| { type: 'SET_TRELLO_BOARDS'; boards: TrelloBoardOption[] }
	| { type: 'SET_TRELLO_BOARD_ID'; id: string }
	| { type: 'SET_TRELLO_BOARD_DETAILS'; details: TrelloBoardDetails | null }
	| { type: 'SET_TRELLO_LIST_MAPPING'; key: string; value: string }
	| { type: 'SET_TRELLO_LABEL_MAPPING'; key: string; value: string }
	| { type: 'SET_TRELLO_COST_FIELD'; id: string }
	| { type: 'ADD_TRELLO_BOARD_LABEL'; label: { id: string; name: string; color: string } }
	| {
			type: 'ADD_TRELLO_BOARD_CUSTOM_FIELD';
			customField: { id: string; name: string; type: string };
	  };

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

export function isTrelloWizardAction(action: { type: string }): action is TrelloWizardAction {
	return action.type.includes('TRELLO');
}

export function trelloWizardReducer<T extends TrelloWizardStateSlice & VerificationState>(
	state: T,
	action: TrelloWizardAction,
): T {
	switch (action.type) {
		case 'SET_TRELLO_API_KEY':
			return {
				...state,
				trelloApiKey: action.value,
				verificationResult: null,
				verifyError: null,
			};
		case 'SET_TRELLO_TOKEN':
			return {
				...state,
				trelloToken: action.value,
				verificationResult: null,
				verifyError: null,
			};
		case 'SET_TRELLO_BOARDS':
			return { ...state, trelloBoards: action.boards };
		case 'SET_TRELLO_BOARD_ID':
			return {
				...state,
				...resetTrelloBoardState(action.id),
			};
		case 'SET_TRELLO_BOARD_DETAILS':
			return { ...state, trelloBoardDetails: action.details };
		case 'SET_TRELLO_LIST_MAPPING':
			return {
				...state,
				trelloListMappings: { ...state.trelloListMappings, [action.key]: action.value },
			};
		case 'SET_TRELLO_LABEL_MAPPING':
			return {
				...state,
				trelloLabelMappings: { ...state.trelloLabelMappings, [action.key]: action.value },
			};
		case 'SET_TRELLO_COST_FIELD':
			return { ...state, trelloCostFieldId: action.id };
		case 'ADD_TRELLO_BOARD_LABEL':
			if (!state.trelloBoardDetails) return state;
			return {
				...state,
				trelloBoardDetails: {
					...state.trelloBoardDetails,
					labels: [...state.trelloBoardDetails.labels, action.label],
				},
			};
		case 'ADD_TRELLO_BOARD_CUSTOM_FIELD':
			if (!state.trelloBoardDetails) return state;
			return {
				...state,
				trelloBoardDetails: {
					...state.trelloBoardDetails,
					customFields: [...state.trelloBoardDetails.customFields, action.customField],
				},
			};
	}
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
