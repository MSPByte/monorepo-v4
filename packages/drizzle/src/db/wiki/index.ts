import {
  uuid,
  text,
  integer,
  timestamp,
  unique,
  foreignKey,
  jsonb,
  primaryKey,
  index,
  customType
} from 'drizzle-orm/pg-core';
import { crudPolicy, authenticatedRole } from 'drizzle-orm/neon';
import { wikiSchema } from '../schemas.js';
import { sites, users } from '../public/index.js';

const rls = crudPolicy({ role: authenticatedRole, read: true, modify: false });

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  }
});

export const contexts = wikiSchema.table(
  'contexts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    parentId: uuid('parent_id'),

    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [
    rls,
    unique('unique_pid_slug').on(t.parentId, t.slug),
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id] }).onDelete('cascade')
  ]
);

export const articleStatusEnum = wikiSchema.enum('e_article_status', [
  'draft',
  'published',
  'archived'
]);

export const articles = wikiSchema.table(
  'articles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kbNumber: integer('kb_number').notNull().unique(),
    primaryContextId: uuid('primary_context_id')
      .references(() => contexts.id)
      .notNull(),

    title: text('title').notNull(),
    slug: text('slug').notNull(),
    status: articleStatusEnum('status').notNull().default('published'),

    contentJson: jsonb('content_json').notNull(),
    contentText: text('content_text').notNull(),
    searchVector: tsvector('search_vector'),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [rls, index('articles_search_vector_idx').using('gin', t.searchVector)]
);

export const articleContexts = wikiSchema.table(
  'article_contexts',
  {
    articleId: uuid('article_id')
      .references(() => articles.id, { onDelete: 'cascade' })
      .notNull(),
    contextId: uuid('context_id')
      .references(() => contexts.id, { onDelete: 'cascade' })
      .notNull(),
    relationship: text('relationship').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [primaryKey({ columns: [t.articleId, t.contextId] })]
);

export const tags = wikiSchema.table(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    color: text('color').notNull(),
    description: text('description').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [rls]
);

export const articleTags = wikiSchema.table(
  'article_tags',
  {
    articleId: uuid('article_id')
      .references(() => articles.id, { onDelete: 'cascade' })
      .notNull(),
    tagId: uuid('tag_id')
      .references(() => tags.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [rls, primaryKey({ columns: [t.articleId, t.tagId] })]
);

export const articleOverrides = wikiSchema.table(
  'article_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    articleId: uuid('article_id')
      .references(() => articles.id, { onDelete: 'cascade' })
      .notNull(),
    siteId: uuid('site_id')
      .references(() => sites.id, { onDelete: 'cascade' })
      .notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    contentJson: jsonb('content_json').notNull(),
    contentText: text('content_text').notNull(),
    searchVector: tsvector('search_vector'),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [
    unique('unique_article_site').on(t.articleId, t.siteId),
    index('article_overrides_search_vector_idx').using('gin', t.searchVector),
    rls
  ]
);

export const articleVersions = wikiSchema.table(
  'article_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    articleId: uuid('article_id')
      .references(() => articles.id, { onDelete: 'cascade' })
      .notNull(),
    versionNumber: integer('version_number').notNull(),

    title: text('title').notNull(),
    primaryContextId: uuid('primary_context_id').references(() => contexts.id, {
      onDelete: 'set null'
    }),
    contentJson: jsonb('content_json').notNull(),
    contentText: text('content_text').notNull(),
    changeNote: text('change_note'),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [
    unique('unique_article_version').on(t.articleId, t.versionNumber),
    index('article_versions_article_created_idx').on(t.articleId, t.createdAt),
    rls
  ]
);

export const articleDrafts = wikiSchema.table(
  'article_drafts',
  {
    articleId: uuid('article_id')
      .primaryKey()
      .references(() => articles.id, { onDelete: 'cascade' }),
    baseVersionId: uuid('base_version_id').references(() => articleVersions.id, {
      onDelete: 'set null'
    }),

    title: text('title').notNull(),
    primaryContextId: uuid('primary_context_id')
      .references(() => contexts.id)
      .notNull(),
    linkedContextIds: jsonb('linked_context_ids').notNull().default([]),
    tagIds: jsonb('tag_ids').notNull().default([]),
    contentJson: jsonb('content_json').notNull(),
    contentText: text('content_text').notNull(),
    changeNote: text('change_note'),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [
    index('article_drafts_updated_idx').on(t.updatedAt),
    index('article_drafts_updated_by_idx').on(t.updatedBy),
    rls
  ]
);

export const articleReferences = wikiSchema.table(
  'article_references',
  {
    sourceArticleId: uuid('source_article_id')
      .references(() => articles.id, { onDelete: 'cascade' })
      .notNull(),
    targetArticleId: uuid('target_article_id')
      .references(() => articles.id, { onDelete: 'cascade' })
      .notNull(),
    sourceVersionId: uuid('source_version_id').references(() => articleVersions.id, {
      onDelete: 'set null'
    }),

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [
    primaryKey({ columns: [t.sourceArticleId, t.targetArticleId] }),
    index('article_references_target_idx').on(t.targetArticleId),
    rls
  ]
);

export const articleLinks = wikiSchema.table(
  'article_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    articleId: uuid('article_id')
      .references(() => articles.id, { onDelete: 'cascade' })
      .notNull(),

    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    relationship: text('relationship').notNull(),

    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow()
  },
  (t) => [
    unique('unique_article_target_relationship').on(
      t.articleId,
      t.targetType,
      t.targetId,
      t.relationship
    ),
    index('article_links_target_idx').on(t.targetType, t.targetId),
    index('article_links_article_idx').on(t.articleId),
    rls
  ]
);

export const editLocks = wikiSchema.table(
  'edit_locks',
  {
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    lockedBy: uuid('locked_by')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull()
  },
  (t) => [
    primaryKey({ columns: [t.resourceType, t.resourceId] }),
    index('edit_locks_expires_idx').on(t.expiresAt),
    index('edit_locks_user_idx').on(t.lockedBy),
    rls
  ]
);

export type WikiContext = typeof contexts.$inferSelect;
export type WikiArticle = typeof articles.$inferSelect;
export type WikiArticleContext = typeof articleContexts.$inferSelect;
export type WikiTag = typeof tags.$inferSelect;
export type WikiArticleTag = typeof articleTags.$inferSelect;
export type WikiArticleOverride = typeof articleOverrides.$inferSelect;
export type WikiArticleVersion = typeof articleVersions.$inferSelect;
export type WikiArticleDraft = typeof articleDrafts.$inferSelect;
export type WikiArticleReference = typeof articleReferences.$inferSelect;
export type WikiArticleLink = typeof articleLinks.$inferSelect;
export type WikiEditLock = typeof editLocks.$inferSelect;
