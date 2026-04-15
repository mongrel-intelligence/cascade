import { useMutation, useQueryClient } from '@tanstack/react-query';
import { trpc, trpcClient } from '@/lib/trpc.js';

type ProjectUpdateInput = Parameters<typeof trpcClient.projects.update.mutate>[0];

/**
 * Shared hook for updating a project.
 * Both ProjectGeneralForm and ProjectHarnessForm use this to ensure consistent
 * cache invalidation and UX behaviour.
 */
export function useProjectUpdate(projectId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (data: Omit<ProjectUpdateInput, 'id'>) =>
			trpcClient.projects.update.mutate({ id: projectId, ...data } as ProjectUpdateInput),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: trpc.projects.getById.queryOptions({ id: projectId }).queryKey,
			});
			queryClient.invalidateQueries({ queryKey: trpc.projects.listFull.queryOptions().queryKey });
		},
	});
}
