/** Compatibility library entry. Prompts/exit handling belong to index.ts only. */
export { migrateSite as runMigrate } from '../services/migrate.js'
export type { MigrateOptions } from '../services/migrate.js'
