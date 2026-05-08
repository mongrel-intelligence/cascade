import { describe, expectTypeOf, it } from 'vitest';
import type { LifecycleHooks } from '../../../../src/agents/definitions/schema.js';
import type { PMLifecycleManager } from '../../../../src/pm/index.js';
import type { AgentExecutionConfig as ReExportedAgentExecutionConfig } from '../../../../src/triggers/shared/agent-execution.js';
import type {
	AgentExecutionConfig,
	AgentExecutionContext,
} from '../../../../src/triggers/shared/agent-execution-types.js';
import type { TriggerResult } from '../../../../src/triggers/types.js';
import type { AgentInput, CascadeConfig, ProjectConfig } from '../../../../src/types/index.js';

describe('agent execution shared types', () => {
	it('keeps AgentExecutionConfig available from the existing agent-execution module', () => {
		expectTypeOf<ReExportedAgentExecutionConfig>().toEqualTypeOf<AgentExecutionConfig>();
	});

	it('captures the resolved execution context contract for later extraction helpers', () => {
		expectTypeOf<AgentExecutionContext>().toHaveProperty('result').toEqualTypeOf<TriggerResult>();
		expectTypeOf<AgentExecutionContext>().toHaveProperty('project').toEqualTypeOf<ProjectConfig>();
		expectTypeOf<AgentExecutionContext>().toHaveProperty('config').toEqualTypeOf<CascadeConfig>();
		expectTypeOf<AgentExecutionContext>()
			.toHaveProperty('executionConfig')
			.toEqualTypeOf<AgentExecutionConfig>();
		expectTypeOf<AgentExecutionContext>().toHaveProperty('agentType').toEqualTypeOf<string>();
		expectTypeOf<AgentExecutionContext>().toHaveProperty('logLabel').toEqualTypeOf<string>();
		expectTypeOf<AgentExecutionContext>()
			.toHaveProperty('lifecycle')
			.toEqualTypeOf<PMLifecycleManager>();
		expectTypeOf<AgentExecutionContext>()
			.toHaveProperty('lifecycleHooks')
			.toEqualTypeOf<LifecycleHooks>();
		expectTypeOf<AgentExecutionContext>()
			.toHaveProperty('workItemId')
			.toEqualTypeOf<string | undefined>();
		expectTypeOf<AgentExecutionContext>().toHaveProperty('agentInput').toEqualTypeOf<AgentInput>();
	});
});
