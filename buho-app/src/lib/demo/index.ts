/**
 * The demo listening history, and the measurements that keep it honest.
 *
 * Re-exported from one place so `scripts/demo-stats.mjs` has a single entry
 * point to bundle, and so the app imports the generator without reaching into
 * the model's internals.
 */
export { generateListening, type ListeningOptions } from './listening';
export { generateConversations, type ConversationOptions } from './messages';
export { measureListening, formatStats, type ListeningStats } from './diagnostics';
