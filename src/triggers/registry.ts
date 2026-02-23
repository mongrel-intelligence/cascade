import { logger } from '../utils/logging.js';
import type { TriggerContext, TriggerHandler, TriggerResult } from './types.js';

export class TriggerRegistry {
	private handlers: TriggerHandler[] = [];

	register(handler: TriggerHandler): void {
		this.handlers.push(handler);
		logger.debug('Registered trigger handler', { name: handler.name });
	}

	unregister(name: string): boolean {
		const index = this.handlers.findIndex((h) => h.name === name);
		if (index !== -1) {
			this.handlers.splice(index, 1);
			return true;
		}
		return false;
	}

	async dispatch(ctx: TriggerContext): Promise<TriggerResult | null> {
		for (const handler of this.handlers) {
			if (handler.matches(ctx)) {
				logger.info('Trigger matched', { handler: handler.name, source: ctx.source });
				try {
					const result = await handler.handle(ctx);
					if (result !== null) return result;
					logger.debug('Trigger handler returned null, continuing', {
						handler: handler.name,
					});
				} catch (err) {
					logger.error('Trigger handler failed', {
						handler: handler.name,
						error: String(err),
					});
					throw err;
				}
			}
		}
		logger.debug('No trigger matched', { source: ctx.source });
		return null;
	}

	getHandlers(): TriggerHandler[] {
		return [...this.handlers];
	}
}

export function createTriggerRegistry(): TriggerRegistry {
	return new TriggerRegistry();
}
