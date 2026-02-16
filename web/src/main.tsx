import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import './index.css';

// biome-ignore lint/style/noNonNullAssertion: root element always exists
createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
