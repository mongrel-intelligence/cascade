/**
 * Barrel re-export for backward compatibility.
 *
 * The original god-module has been split into focused single-responsibility modules:
 *   - organizationsRepository.ts   (getOrganization, updateOrganization, listAllOrganizations)
 *   - projectsRepository.ts        (listProjectsFull, getProjectFull, createProject, updateProject, deleteProject)
 *   - integrationsRepository.ts    (all projectIntegration* + integrationCredential* functions)
 *   - agentConfigsRepository.ts    (listAgentConfigs, createAgentConfig, updateAgentConfig, deleteAgentConfig, getMaxConcurrency)
 *
 * All existing import sites continue to work without modification.
 * Consumers can migrate to the focused modules at their own pace.
 */

export * from './agentConfigsRepository.js';
export * from './integrationsRepository.js';
export * from './organizationsRepository.js';
export * from './projectsRepository.js';
