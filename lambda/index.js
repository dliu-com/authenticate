import { createBroker } from './broker.js';
import { loadConfig } from './config.js';
import { Store } from './store.js';

export const handler = createBroker({ store: new Store(process.env.TABLE_NAME), loadConfig });
