import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const workspaces = sqliteTable('workspaces', {
  userId: text('user_id').primaryKey(),
  content: text('content').notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
});
export const computeConnections = sqliteTable('compute_connections', {
  userId: text('user_id').primaryKey(),
  baseUrl: text('base_url').notNull(),
  encryptedToken: text('encrypted_token').notNull(),
  updatedAt: text('updated_at').notNull(),
});
export const computeJobs = sqliteTable('compute_jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  kind: text('kind').notNull(),
  label: text('label').notNull(),
  snapshot: text('snapshot').notNull(),
  createdAt: text('created_at').notNull(),
});
export const assistantSessions = sqliteTable('assistant_sessions', {
  userId: text('user_id').primaryKey(),
  objectKey: text('object_key').notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
});
export const athenaProjects = sqliteTable('athena_projects', {
  userId: text('user_id').primaryKey(),
  objectKey: text('object_key').notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
});
export const spectraCollections = sqliteTable('spectra_collections', {
 id: text('id').primaryKey(), userId: text('user_id').notNull(), name: text('name').notNull(),
 sha256: text('sha256').notNull(), objectKey: text('object_key').notNull(),
 summary: text('summary').notNull(), revision: integer('revision').notNull().default(1), createdAt: text('created_at').notNull(),
});
export const xanesAnalyses = sqliteTable('xanes_analyses', {
 id: text('id').primaryKey(), userId: text('user_id').notNull(), collectionId: text('collection_id').notNull(),
 objectKey: text('object_key').notNull(), summary: text('summary').notNull(), createdAt: text('created_at').notNull(),
});

export const fdmnesComparisons = sqliteTable('fdmnes_comparisons', {
 id:text('id').primaryKey(),userId:text('user_id').notNull(),objectKey:text('object_key').notNull(),summary:text('summary').notNull(),createdAt:text('created_at').notNull(),
});
