/**
 * useDefinitionEditor — encapsulates all editor state and mutations for the
 * agent definition editor. Extracted from agent-definition-editor.tsx to keep
 * the main component as a thin orchestrator.
 */
import { trpc, trpcClient } from '@/lib/trpc.js';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
	type AgentDefinition,
	type DefinitionRow,
	EMPTY_DEFINITION,
} from './agent-definition-shared.js';

export function useDefinitionEditor(existing: DefinitionRow | undefined, onClose: () => void) {
	const queryClient = useQueryClient();
	const isEdit = !!existing;
	const queryKey = trpc.agentDefinitions.list.queryOptions().queryKey;

	const [agentType, setAgentType] = useState(existing?.agentType ?? '');
	const [def, setDef] = useState<AgentDefinition>(existing?.definition ?? EMPTY_DEFINITION);
	const [jsonText, setJsonText] = useState(
		existing
			? JSON.stringify(existing.definition, null, 2)
			: JSON.stringify(EMPTY_DEFINITION, null, 2),
	);
	const [jsonError, setJsonError] = useState<string | null>(null);
	const [agentTypeError, setAgentTypeError] = useState<string | null>(null);
	const [activeTab, setActiveTab] = useState('definition');

	const onSuccess = () => {
		queryClient.invalidateQueries({ queryKey });
		onClose();
	};

	const createMutation = useMutation({
		mutationFn: (params: { agentType: string; definition: AgentDefinition }) =>
			trpcClient.agentDefinitions.create.mutate(params),
		onSuccess,
	});

	const updateMutation = useMutation({
		mutationFn: (params: { agentType: string; patch: AgentDefinition }) =>
			trpcClient.agentDefinitions.update.mutate(params),
		onSuccess,
	});

	const activeMutation = isEdit ? updateMutation : createMutation;

	const handleTabChange = (tab: string) => {
		const structuredTabs = ['definition', 'capabilities', 'triggers'];
		const isLeavingStructured = structuredTabs.includes(activeTab);
		const isEnteringStructured = structuredTabs.includes(tab);

		if (tab === 'json' && isLeavingStructured) {
			setJsonText(JSON.stringify(def, null, 2));
			setJsonError(null);
		} else if (isEnteringStructured && activeTab === 'json') {
			try {
				setDef(JSON.parse(jsonText) as AgentDefinition);
				setJsonError(null);
			} catch (err) {
				setJsonError((err as Error).message);
				return; // keep user on JSON tab so they can fix the error
			}
		}
		setActiveTab(tab);
	};

	const handleSave = () => {
		if (!isEdit && !agentType.trim()) {
			setAgentTypeError('Agent type is required.');
			return;
		}

		let submission = def;
		if (activeTab === 'json') {
			try {
				submission = JSON.parse(jsonText) as AgentDefinition;
				setDef(submission);
				setJsonError(null);
			} catch (err) {
				setJsonError((err as Error).message);
				return;
			}
		}
		if (isEdit && existing) {
			updateMutation.mutate({ agentType: existing.agentType, patch: submission });
		} else {
			createMutation.mutate({ agentType, definition: submission });
		}
	};

	const setIdentity = (k: keyof AgentDefinition['identity'], v: string) =>
		setDef((d) => ({ ...d, identity: { ...d.identity, [k]: v } }));

	const clearJsonError = () => setJsonError(null);

	const updateAgentType = (value: string) => {
		setAgentType(value);
		if (agentTypeError) setAgentTypeError(null);
	};

	return {
		isEdit,
		agentType,
		setAgentType: updateAgentType,
		def,
		setDef,
		jsonText,
		setJsonText,
		jsonError,
		clearJsonError,
		agentTypeError,
		activeTab,
		activeMutation,
		handleTabChange,
		handleSave,
		setIdentity,
	};
}
