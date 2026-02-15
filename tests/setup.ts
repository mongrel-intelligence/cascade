import { afterEach } from 'vitest';
import { invalidateConfigCache } from '../src/config/provider.js';

afterEach(() => {
	invalidateConfigCache();
});
