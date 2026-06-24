import {
  contexts,
  articles,
  articleDrafts,
  articleContexts,
  tags,
  articleTags,
  articleOverrides,
  articleVersions,
  articleReferences,
  editLocks,
  users,
  sites
} from '@mspbyte/drizzle';
import { eq, and, desc, asc, sql, inArray, or, max, count } from 'drizzle-orm';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';
import { shortId } from '../short-id.js';
import { alias } from 'drizzle-orm/pg-core';
import type { Context } from '../context.js';

function formatKbId(kbNumber: number): string {
  return `KB${String(kbNumber).padStart(3, '0')}`;
}

const emptyArticleContent = { type: 'doc', content: [] };
const articleStatusSchema = z.enum(['draft', 'published', 'archived']);

async function getLatestArticleVersionId(db: Pick<Context['db'], 'select'>, articleId: string) {
  const [latestVersion] = await db
    .select({ id: articleVersions.id })
    .from(articleVersions)
    .where(eq(articleVersions.articleId, articleId))
    .orderBy(desc(articleVersions.versionNumber))
    .limit(1);

  return latestVersion?.id ?? null;
}

// ── Contexts ──────────────────────────────────────────────

const contextsRouter = t.router({
  list: authProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(contexts).orderBy(asc(contexts.sortOrder), asc(contexts.name));
  }),

  create: authProcedure
    .input(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        parentId: z.string().uuid().nullable()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [maxSort] = await ctx.db
        .select({ val: max(contexts.sortOrder) })
        .from(contexts)
        .where(
          input.parentId ? eq(contexts.parentId, input.parentId) : sql`${contexts.parentId} IS NULL`
        );

      const [row] = await ctx.db
        .insert(contexts)
        .values({
          name: input.name,
          slug: shortId(),
          description: input.description ?? null,
          parentId: input.parentId,
          sortOrder: (maxSort?.val ?? -1) + 1
        })
        .returning();

      return row!;
    }),

  update: authProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      const values: Record<string, unknown> = {};
      if (patch.name !== undefined) values.name = patch.name;
      if (patch.description !== undefined) values.description = patch.description;

      if (Object.keys(values).length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nothing to update' });
      }

      const [row] = await ctx.db
        .update(contexts)
        .set(values)
        .where(eq(contexts.id, id))
        .returning();

      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  remove: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [target] = await ctx.db
        .select()
        .from(contexts)
        .where(eq(contexts.id, input.id))
        .limit(1);

      if (!target) throw new TRPCError({ code: 'NOT_FOUND' });

      const fallbackContextId = target.parentId;

      if (fallbackContextId) {
        await ctx.db
          .update(articles)
          .set({ primaryContextId: fallbackContextId })
          .where(eq(articles.primaryContextId, input.id));
      } else {
        const [anyRoot] = await ctx.db
          .select({ id: contexts.id })
          .from(contexts)
          .where(and(sql`${contexts.parentId} IS NULL`, sql`${contexts.id} != ${input.id}`))
          .limit(1);

        if (anyRoot) {
          await ctx.db
            .update(articles)
            .set({ primaryContextId: anyRoot.id })
            .where(eq(articles.primaryContextId, input.id));
        }
      }

      await ctx.db.delete(contexts).where(eq(contexts.id, input.id));
      return { success: true };
    })
});

// ── Tags ──────────────────────────────────────────────────

const tagsRouter = t.router({
  list: authProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: tags.id,
        name: tags.name,
        slug: tags.slug,
        color: tags.color,
        description: tags.description,
        createdAt: tags.createdAt,
        articleCount: sql<number>`(
          SELECT count(*)::int FROM wiki.article_tags WHERE tag_id = ${tags.id}
        )`
      })
      .from(tags)
      .orderBy(asc(tags.name));

    return rows;
  }),

  create: authProcedure
    .input(
      z.object({
        name: z.string().min(1),
        color: z.string(),
        description: z.string().default('')
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(tags)
        .values({
          name: input.name,
          slug: shortId(),
          color: input.color,
          description: input.description
        })
        .returning();
      return row!;
    }),

  update: authProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        color: z.string().optional(),
        description: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      const values: Record<string, unknown> = {};
      if (patch.name !== undefined) values.name = patch.name;
      if (patch.color !== undefined) values.color = patch.color;
      if (patch.description !== undefined) values.description = patch.description;

      if (Object.keys(values).length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nothing to update' });
      }

      const [row] = await ctx.db.update(tags).set(values).where(eq(tags.id, id)).returning();

      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  remove: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(tags).where(eq(tags.id, input.id));
      return { success: true };
    })
});

// ── Articles ──────────────────────────────────────────────

const createdByUser = alias(users, 'createdByUser');
const draftUpdatedByUser = alias(users, 'draftUpdatedByUser');

const articlesRouter = t.router({
  list: authProcedure
    .input(
      z
        .object({
          contextId: z.string().uuid().optional(),
          tagId: z.string().uuid().optional()
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const primaryCtx = alias(contexts, 'primaryCtx');

      const baseRows = await ctx.db
        .select({
          id: articles.id,
          kbNumber: articles.kbNumber,
          title: articles.title,
          slug: articles.slug,
          status: articles.status,
          primaryContextId: articles.primaryContextId,
          primaryContextName: primaryCtx.name,
          contentJson: articles.contentJson,
          contentText: articles.contentText,
          createdById: createdByUser.id,
          createdByName: createdByUser.name,
          createdAt: articles.createdAt,
          updatedAt: articles.updatedAt
        })
        .from(articles)
        .leftJoin(primaryCtx, eq(articles.primaryContextId, primaryCtx.id))
        .leftJoin(createdByUser, eq(articles.createdBy, createdByUser.id))
        .orderBy(desc(articles.updatedAt));

      let articleIds = baseRows.map((r) => r.id);
      if (articleIds.length === 0) return [];

      // Filter by context
      if (input?.contextId) {
        const linkedIds = await ctx.db
          .select({ articleId: articleContexts.articleId })
          .from(articleContexts)
          .where(eq(articleContexts.contextId, input.contextId));

        const linkedSet = new Set(linkedIds.map((r) => r.articleId));
        articleIds = baseRows
          .filter((r) => r.primaryContextId === input.contextId || linkedSet.has(r.id))
          .map((r) => r.id);

        if (articleIds.length === 0) return [];
      }

      // Filter by tag
      if (input?.tagId) {
        const taggedIds = await ctx.db
          .select({ articleId: articleTags.articleId })
          .from(articleTags)
          .where(eq(articleTags.tagId, input.tagId));

        const taggedSet = new Set(taggedIds.map((r) => r.articleId));
        articleIds = articleIds.filter((id) => taggedSet.has(id));

        if (articleIds.length === 0) return [];
      }

      // Batch-load tags and linked contexts for filtered articles
      const [tagRows, linkedCtxRows, lockRows] = await Promise.all([
        ctx.db
          .select({
            articleId: articleTags.articleId,
            tagId: tags.id,
            tagName: tags.name,
            tagColor: tags.color
          })
          .from(articleTags)
          .innerJoin(tags, eq(articleTags.tagId, tags.id))
          .where(inArray(articleTags.articleId, articleIds)),
        ctx.db
          .select({
            articleId: articleContexts.articleId,
            contextId: contexts.id,
            contextName: contexts.name,
            relationship: articleContexts.relationship
          })
          .from(articleContexts)
          .innerJoin(contexts, eq(articleContexts.contextId, contexts.id))
          .where(inArray(articleContexts.articleId, articleIds)),
        ctx.db
          .select()
          .from(editLocks)
          .innerJoin(users, eq(editLocks.lockedBy, users.id))
          .where(
            and(
              eq(editLocks.resourceType, 'article'),
              inArray(editLocks.resourceId, articleIds),
              sql`${editLocks.expiresAt} > now()`
            )
          )
      ]);

      const tagsByArticle = new Map<string, Array<{ id: string; name: string; color: string }>>();
      for (const r of tagRows) {
        const arr = tagsByArticle.get(r.articleId) ?? [];
        arr.push({ id: r.tagId, name: r.tagName, color: r.tagColor });
        tagsByArticle.set(r.articleId, arr);
      }

      const linkedByArticle = new Map<
        string,
        Array<{ id: string; name: string; relationship: string }>
      >();
      for (const r of linkedCtxRows) {
        const arr = linkedByArticle.get(r.articleId) ?? [];
        arr.push({ id: r.contextId, name: r.contextName, relationship: r.relationship });
        linkedByArticle.set(r.articleId, arr);
      }

      const lockByArticle = new Map<
        string,
        { lockedBy: { id: string; name: string }; expiresAt: string }
      >();
      for (const r of lockRows) {
        lockByArticle.set(r.edit_locks.resourceId, {
          lockedBy: { id: r.users.id, name: r.users.name },
          expiresAt: r.edit_locks.expiresAt
        });
      }

      const articleIdSet = new Set(articleIds);

      return baseRows
        .filter((r) => articleIdSet.has(r.id))
        .map((r) => {
          let contextRole: 'primary' | 'linked' | undefined;
          if (input?.contextId) {
            contextRole = r.primaryContextId === input.contextId ? 'primary' : 'linked';
          }

          return {
            id: r.id,
            kbId: formatKbId(r.kbNumber),
            kbNumber: r.kbNumber,
            title: r.title,
            slug: r.slug,
            status: r.status,
            primaryContextId: r.primaryContextId,
            primaryContextName: r.primaryContextName ?? '',
            linkedContexts: linkedByArticle.get(r.id) ?? [],
            tags: tagsByArticle.get(r.id) ?? [],
            contentJson: r.contentJson,
            contentText: r.contentText,
            createdBy: r.createdById ? { id: r.createdById, name: r.createdByName ?? '' } : null,
            lock: lockByArticle.get(r.id) ?? null,
            updatedAt: r.updatedAt,
            createdAt: r.createdAt,
            contextRole
          };
        });
    }),

  get: authProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const primaryCtx = alias(contexts, 'primaryCtx');

    const [row] = await ctx.db
      .select({
        id: articles.id,
        kbNumber: articles.kbNumber,
        title: articles.title,
        slug: articles.slug,
        status: articles.status,
        primaryContextId: articles.primaryContextId,
        primaryContextName: primaryCtx.name,
        contentJson: articles.contentJson,
        contentText: articles.contentText,
        createdById: createdByUser.id,
        createdByName: createdByUser.name,
        createdAt: articles.createdAt,
        updatedAt: articles.updatedAt
      })
      .from(articles)
      .leftJoin(primaryCtx, eq(articles.primaryContextId, primaryCtx.id))
      .leftJoin(createdByUser, eq(articles.createdBy, createdByUser.id))
      .where(eq(articles.id, input.id))
      .limit(1);

    if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

    const [tagRows, linkedCtxRows, overrideRows, versionRows, lockRow, draftRow] =
      await Promise.all([
        ctx.db
          .select({
            tagId: tags.id,
            tagName: tags.name,
            tagSlug: tags.slug,
            tagColor: tags.color
          })
          .from(articleTags)
          .innerJoin(tags, eq(articleTags.tagId, tags.id))
          .where(eq(articleTags.articleId, input.id)),
        ctx.db
          .select({
            contextId: contexts.id,
            contextName: contexts.name,
            relationship: articleContexts.relationship
          })
          .from(articleContexts)
          .innerJoin(contexts, eq(articleContexts.contextId, contexts.id))
          .where(eq(articleContexts.articleId, input.id)),
        ctx.db
          .select({
            id: articleOverrides.id,
            siteId: articleOverrides.siteId,
            siteName: sites.name,
            type: articleOverrides.type,
            title: articleOverrides.title,
            contentJson: articleOverrides.contentJson,
            contentText: articleOverrides.contentText,
            createdBy: articleOverrides.createdBy,
            createdAt: articleOverrides.createdAt,
            updatedAt: articleOverrides.updatedAt
          })
          .from(articleOverrides)
          .innerJoin(sites, eq(articleOverrides.siteId, sites.id))
          .where(eq(articleOverrides.articleId, input.id)),
        ctx.db
          .select({
            id: articleVersions.id,
            versionNumber: articleVersions.versionNumber,
            title: articleVersions.title,
            changeNote: articleVersions.changeNote,
            createdById: createdByUser.id,
            createdByName: createdByUser.name,
            createdAt: articleVersions.createdAt
          })
          .from(articleVersions)
          .leftJoin(createdByUser, eq(articleVersions.createdBy, createdByUser.id))
          .where(eq(articleVersions.articleId, input.id))
          .orderBy(desc(articleVersions.versionNumber)),
        ctx.db
          .select({
            lockedById: users.id,
            lockedByName: users.name,
            expiresAt: editLocks.expiresAt
          })
          .from(editLocks)
          .innerJoin(users, eq(editLocks.lockedBy, users.id))
          .where(
            and(
              eq(editLocks.resourceType, 'article'),
              eq(editLocks.resourceId, input.id),
              sql`${editLocks.expiresAt} > now()`
            )
          )
          .limit(1),
        ctx.db
          .select({
            articleId: articleDrafts.articleId,
            baseVersionId: articleDrafts.baseVersionId,
            title: articleDrafts.title,
            primaryContextId: articleDrafts.primaryContextId,
            linkedContextIds: articleDrafts.linkedContextIds,
            tagIds: articleDrafts.tagIds,
            contentJson: articleDrafts.contentJson,
            contentText: articleDrafts.contentText,
            changeNote: articleDrafts.changeNote,
            createdAt: articleDrafts.createdAt,
            updatedAt: articleDrafts.updatedAt,
            updatedById: draftUpdatedByUser.id,
            updatedByName: draftUpdatedByUser.name
          })
          .from(articleDrafts)
          .leftJoin(draftUpdatedByUser, eq(articleDrafts.updatedBy, draftUpdatedByUser.id))
          .where(eq(articleDrafts.articleId, input.id))
          .limit(1)
      ]);

    return {
      id: row.id,
      kbId: formatKbId(row.kbNumber),
      kbNumber: row.kbNumber,
      title: row.title,
      slug: row.slug,
      status: row.status,
      primaryContextId: row.primaryContextId,
      primaryContextName: row.primaryContextName ?? '',
      linkedContexts: linkedCtxRows.map((r) => ({
        id: r.contextId,
        name: r.contextName,
        relationship: r.relationship
      })),
      tags: tagRows.map((r) => ({
        id: r.tagId,
        name: r.tagName,
        slug: r.tagSlug,
        color: r.tagColor
      })),
      overrides: overrideRows.map((r) => ({
        id: r.id,
        siteId: r.siteId,
        siteName: r.siteName,
        type: r.type,
        title: r.title,
        contentJson: r.contentJson,
        contentText: r.contentText,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt
      })),
      versions: versionRows.map((r) => ({
        id: r.id,
        versionNumber: r.versionNumber,
        title: r.title,
        changeNote: r.changeNote,
        createdBy: r.createdById ? { id: r.createdById, name: r.createdByName ?? '' } : null,
        createdAt: r.createdAt
      })),
      draft: draftRow[0]
        ? {
            articleId: draftRow[0].articleId,
            baseVersionId: draftRow[0].baseVersionId,
            title: draftRow[0].title,
            primaryContextId: draftRow[0].primaryContextId,
            linkedContextIds: draftRow[0].linkedContextIds as string[],
            tagIds: draftRow[0].tagIds as string[],
            contentJson: draftRow[0].contentJson,
            contentText: draftRow[0].contentText,
            changeNote: draftRow[0].changeNote,
            updatedBy: draftRow[0].updatedById
              ? { id: draftRow[0].updatedById, name: draftRow[0].updatedByName ?? '' }
              : null,
            updatedAt: draftRow[0].updatedAt,
            createdAt: draftRow[0].createdAt
          }
        : null,
      contentJson: row.contentJson,
      contentText: row.contentText,
      createdBy: row.createdById ? { id: row.createdById, name: row.createdByName ?? '' } : null,
      lock: lockRow[0]
        ? {
            lockedBy: { id: lockRow[0].lockedById, name: lockRow[0].lockedByName },
            expiresAt: lockRow[0].expiresAt
          }
        : null,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt
    };
  }),

  getByKbNumber: authProcedure
    .input(z.object({ kbNumber: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: articles.id })
        .from(articles)
        .where(eq(articles.kbNumber, input.kbNumber))
        .limit(1);

      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  recent: authProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(6) }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 6;
      const primaryCtx = alias(contexts, 'primaryCtx');

      const rows = await ctx.db
        .select({
          id: articles.id,
          kbNumber: articles.kbNumber,
          title: articles.title,
          primaryContextId: articles.primaryContextId,
          primaryContextName: primaryCtx.name,
          createdByName: createdByUser.name,
          updatedAt: articles.updatedAt
        })
        .from(articles)
        .leftJoin(primaryCtx, eq(articles.primaryContextId, primaryCtx.id))
        .leftJoin(createdByUser, eq(articles.createdBy, createdByUser.id))
        .orderBy(desc(articles.updatedAt))
        .limit(limit);

      // Batch load locks
      const ids = rows.map((r) => r.id);
      const lockRows =
        ids.length > 0
          ? await ctx.db
              .select({
                resourceId: editLocks.resourceId,
                lockedByName: users.name
              })
              .from(editLocks)
              .innerJoin(users, eq(editLocks.lockedBy, users.id))
              .where(
                and(
                  eq(editLocks.resourceType, 'article'),
                  inArray(editLocks.resourceId, ids),
                  sql`${editLocks.expiresAt} > now()`
                )
              )
          : [];

      const lockMap = new Map(lockRows.map((r) => [r.resourceId, r.lockedByName]));

      return rows.map((r) => ({
        id: r.id,
        kbId: formatKbId(r.kbNumber),
        kbNumber: r.kbNumber,
        title: r.title,
        primaryContextId: r.primaryContextId,
        primaryContextName: r.primaryContextName ?? '',
        createdByName: r.createdByName ?? '',
        lockedBy: lockMap.get(r.id) ?? null,
        updatedAt: r.updatedAt
      }));
    }),

  create: authProcedure
    .input(
      z.object({
        title: z.string().min(1),
        primaryContextId: z.string().uuid(),
        linkedContextIds: z.array(z.string().uuid()).default([]),
        tagIds: z.array(z.string().uuid()).default([]),
        contentJson: z.any(),
        contentText: z.string(),
        status: articleStatusSchema.default('published'),
        changeNote: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [maxKb] = await ctx.db.select({ val: max(articles.kbNumber) }).from(articles);

      const kbNumber = (maxKb?.val ?? 0) + 1;

      const [article] = await ctx.db
        .insert(articles)
        .values({
          kbNumber,
          title: input.title,
          slug: shortId(),
          status: input.status,
          primaryContextId: input.primaryContextId,
          contentJson: input.contentJson,
          contentText: input.contentText,
          createdBy: ctx.user.id
        })
        .returning();

      if (!article) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create article' });
      }

      const linkedIds = input.linkedContextIds.filter((id) => id !== input.primaryContextId);

      await Promise.all([
        linkedIds.length > 0
          ? ctx.db.insert(articleContexts).values(
              linkedIds.map((contextId) => ({
                articleId: article.id,
                contextId,
                relationship: 'linked'
              }))
            )
          : Promise.resolve(),
        input.tagIds.length > 0
          ? ctx.db.insert(articleTags).values(
              input.tagIds.map((tagId) => ({
                articleId: article.id,
                tagId
              }))
            )
          : Promise.resolve(),
        input.status === 'published'
          ? ctx.db.insert(articleVersions).values({
              articleId: article.id,
              versionNumber: 1,
              title: input.title,
              primaryContextId: input.primaryContextId,
              contentJson: input.contentJson,
              contentText: input.contentText,
              changeNote: input.changeNote ?? null,
              createdBy: ctx.user.id
            })
          : Promise.resolve()
      ]);

      return {
        id: article.id,
        kbId: formatKbId(kbNumber),
        kbNumber
      };
    }),

  update: authProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().min(1).optional(),
        primaryContextId: z.string().uuid().optional(),
        linkedContextIds: z.array(z.string().uuid()).optional(),
        tagIds: z.array(z.string().uuid()).optional(),
        contentJson: z.any().optional(),
        contentText: z.string().optional(),
        status: articleStatusSchema.optional(),
        changeNote: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, linkedContextIds, tagIds, changeNote, ...patch } = input;

      const setCols: Record<string, unknown> = { updatedAt: sql`now()` };
      if (patch.title !== undefined) setCols.title = patch.title;
      if (patch.primaryContextId !== undefined) setCols.primaryContextId = patch.primaryContextId;
      if (patch.contentJson !== undefined) setCols.contentJson = patch.contentJson;
      if (patch.contentText !== undefined) setCols.contentText = patch.contentText;
      if (patch.status !== undefined) setCols.status = patch.status;

      const [article] = await ctx.db
        .update(articles)
        .set(setCols)
        .where(eq(articles.id, id))
        .returning();

      if (!article) throw new TRPCError({ code: 'NOT_FOUND' });

      const ops: Promise<unknown>[] = [];

      if (linkedContextIds !== undefined) {
        ops.push(
          ctx.db
            .delete(articleContexts)
            .where(eq(articleContexts.articleId, id))
            .then(() => {
              const filtered = linkedContextIds.filter((cid) => cid !== article.primaryContextId);
              if (filtered.length > 0) {
                return ctx.db.insert(articleContexts).values(
                  filtered.map((contextId) => ({
                    articleId: id,
                    contextId,
                    relationship: 'linked'
                  }))
                );
              }
            })
        );
      }

      if (tagIds !== undefined) {
        ops.push(
          ctx.db
            .delete(articleTags)
            .where(eq(articleTags.articleId, id))
            .then(() => {
              if (tagIds.length > 0) {
                return ctx.db.insert(articleTags).values(
                  tagIds.map((tagId) => ({
                    articleId: id,
                    tagId
                  }))
                );
              }
            })
        );
      }

      // Create a new version
      const [maxVersion] = await ctx.db
        .select({ val: max(articleVersions.versionNumber) })
        .from(articleVersions)
        .where(eq(articleVersions.articleId, id));

      ops.push(
        ctx.db.insert(articleVersions).values({
          articleId: id,
          versionNumber: (maxVersion?.val ?? 0) + 1,
          title: article.title,
          primaryContextId: article.primaryContextId,
          contentJson: article.contentJson,
          contentText: article.contentText,
          changeNote: changeNote ?? null,
          createdBy: ctx.user.id
        })
      );

      await Promise.all(ops);

      return {
        id: article.id,
        kbId: formatKbId(article.kbNumber),
        kbNumber: article.kbNumber
      };
    }),

  updateMeta: authProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        primaryContextId: z.string().uuid(),
        linkedContextIds: z.array(z.string().uuid()).default([]),
        tagIds: z.array(z.string().uuid()).default([])
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const [article] = await tx
          .update(articles)
          .set({
            primaryContextId: input.primaryContextId,
            updatedAt: sql`now()`
          })
          .where(eq(articles.id, input.id))
          .returning();

        if (!article) throw new TRPCError({ code: 'NOT_FOUND' });

        const linkedContextIds = input.linkedContextIds.filter(
          (contextId) => contextId !== input.primaryContextId
        );

        await tx.delete(articleContexts).where(eq(articleContexts.articleId, input.id));
        if (linkedContextIds.length > 0) {
          await tx.insert(articleContexts).values(
            linkedContextIds.map((contextId) => ({
              articleId: input.id,
              contextId,
              relationship: 'linked'
            }))
          );
        }

        await tx.delete(articleTags).where(eq(articleTags.articleId, input.id));
        if (input.tagIds.length > 0) {
          await tx.insert(articleTags).values(
            input.tagIds.map((tagId) => ({
              articleId: input.id,
              tagId
            }))
          );
        }

        return {
          id: article.id,
          kbId: formatKbId(article.kbNumber),
          kbNumber: article.kbNumber
        };
      });
    }),

  archive: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [article] = await ctx.db
        .update(articles)
        .set({
          status: 'archived',
          updatedAt: sql`now()`
        })
        .where(eq(articles.id, input.id))
        .returning();

      if (!article) throw new TRPCError({ code: 'NOT_FOUND' });

      return {
        id: article.id,
        kbId: formatKbId(article.kbNumber),
        kbNumber: article.kbNumber
      };
    }),

  remove: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(articles).where(eq(articles.id, input.id));
      return { success: true };
    })
});

// ── Article Drafts ────────────────────────────────────────

const draftPayloadSchema = z.object({
  articleId: z.string().uuid().optional(),
  title: z.string().min(1),
  primaryContextId: z.string().uuid(),
  linkedContextIds: z.array(z.string().uuid()).default([]),
  tagIds: z.array(z.string().uuid()).default([]),
  contentJson: z.any(),
  contentText: z.string(),
  changeNote: z.string().optional()
});

const draftsRouter = t.router({
  save: authProcedure.input(draftPayloadSchema).mutation(async ({ ctx, input }) => {
    return ctx.db.transaction(async (tx) => {
      let articleId = input.articleId;
      let kbNumber: number;

      if (articleId) {
        const [article] = await tx
          .select({ id: articles.id, kbNumber: articles.kbNumber })
          .from(articles)
          .where(eq(articles.id, articleId))
          .limit(1);

        if (!article) throw new TRPCError({ code: 'NOT_FOUND' });
        kbNumber = article.kbNumber;
      } else {
        const [maxKb] = await tx.select({ val: max(articles.kbNumber) }).from(articles);
        kbNumber = (maxKb?.val ?? 0) + 1;

        const [article] = await tx
          .insert(articles)
          .values({
            kbNumber,
            title: input.title,
            slug: shortId(),
            status: 'draft',
            primaryContextId: input.primaryContextId,
            contentJson: emptyArticleContent,
            contentText: '',
            createdBy: ctx.user.id
          })
          .returning();

        if (!article) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create draft article'
          });
        }

        articleId = article.id;
      }

      const baseVersionId = await getLatestArticleVersionId(tx, articleId);
      const linkedContextIds = input.linkedContextIds.filter((id) => id !== input.primaryContextId);

      await tx
        .insert(articleDrafts)
        .values({
          articleId,
          baseVersionId,
          title: input.title,
          primaryContextId: input.primaryContextId,
          linkedContextIds,
          tagIds: input.tagIds,
          contentJson: input.contentJson,
          contentText: input.contentText,
          changeNote: input.changeNote ?? null,
          createdBy: ctx.user.id,
          updatedBy: ctx.user.id
        })
        .onConflictDoUpdate({
          target: articleDrafts.articleId,
          set: {
            title: input.title,
            primaryContextId: input.primaryContextId,
            linkedContextIds,
            tagIds: input.tagIds,
            contentJson: input.contentJson,
            contentText: input.contentText,
            changeNote: input.changeNote ?? null,
            updatedBy: ctx.user.id,
            updatedAt: sql`now()`
          }
        });

      await tx
        .update(articles)
        .set({
          title: input.title,
          primaryContextId: input.primaryContextId,
          updatedAt: sql`now()`
        })
        .where(and(eq(articles.id, articleId), eq(articles.status, 'draft')));

      return {
        id: articleId,
        kbId: formatKbId(kbNumber),
        kbNumber
      };
    });
  }),

  publish: authProcedure
    .input(draftPayloadSchema.extend({ articleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.transaction(async (tx) => {
        const linkedContextIds = input.linkedContextIds.filter(
          (id) => id !== input.primaryContextId
        );

        await tx
          .insert(articleDrafts)
          .values({
            articleId: input.articleId,
            baseVersionId: await getLatestArticleVersionId(tx, input.articleId),
            title: input.title,
            primaryContextId: input.primaryContextId,
            linkedContextIds,
            tagIds: input.tagIds,
            contentJson: input.contentJson,
            contentText: input.contentText,
            changeNote: input.changeNote ?? null,
            createdBy: ctx.user.id,
            updatedBy: ctx.user.id
          })
          .onConflictDoUpdate({
            target: articleDrafts.articleId,
            set: {
              title: input.title,
              primaryContextId: input.primaryContextId,
              linkedContextIds,
              tagIds: input.tagIds,
              contentJson: input.contentJson,
              contentText: input.contentText,
              changeNote: input.changeNote ?? null,
              updatedBy: ctx.user.id,
              updatedAt: sql`now()`
            }
          });

        const [article] = await tx
          .update(articles)
          .set({
            title: input.title,
            status: 'published',
            primaryContextId: input.primaryContextId,
            contentJson: input.contentJson,
            contentText: input.contentText,
            updatedAt: sql`now()`
          })
          .where(eq(articles.id, input.articleId))
          .returning();

        if (!article) throw new TRPCError({ code: 'NOT_FOUND' });

        await tx.delete(articleContexts).where(eq(articleContexts.articleId, input.articleId));
        if (linkedContextIds.length > 0) {
          await tx.insert(articleContexts).values(
            linkedContextIds.map((contextId) => ({
              articleId: input.articleId,
              contextId,
              relationship: 'linked'
            }))
          );
        }

        await tx.delete(articleTags).where(eq(articleTags.articleId, input.articleId));
        if (input.tagIds.length > 0) {
          await tx.insert(articleTags).values(
            input.tagIds.map((tagId) => ({
              articleId: input.articleId,
              tagId
            }))
          );
        }

        const [maxVersion] = await tx
          .select({ val: max(articleVersions.versionNumber) })
          .from(articleVersions)
          .where(eq(articleVersions.articleId, input.articleId));

        await tx.insert(articleVersions).values({
          articleId: input.articleId,
          versionNumber: (maxVersion?.val ?? 0) + 1,
          title: input.title,
          primaryContextId: input.primaryContextId,
          contentJson: input.contentJson,
          contentText: input.contentText,
          changeNote: input.changeNote ?? null,
          createdBy: ctx.user.id
        });

        await tx.delete(articleDrafts).where(eq(articleDrafts.articleId, input.articleId));

        return {
          id: article.id,
          kbId: formatKbId(article.kbNumber),
          kbNumber: article.kbNumber
        };
      });
    }),

  remove: authProcedure
    .input(z.object({ articleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(articleDrafts).where(eq(articleDrafts.articleId, input.articleId));
      return { success: true };
    })
});

// ── Overrides ─────────────────────────────────────────────

const overridesRouter = t.router({
  listForArticle: authProcedure
    .input(z.object({ articleId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: articleOverrides.id,
          articleId: articleOverrides.articleId,
          siteId: articleOverrides.siteId,
          siteName: sites.name,
          type: articleOverrides.type,
          title: articleOverrides.title,
          contentJson: articleOverrides.contentJson,
          contentText: articleOverrides.contentText,
          createdAt: articleOverrides.createdAt,
          updatedAt: articleOverrides.updatedAt
        })
        .from(articleOverrides)
        .innerJoin(sites, eq(articleOverrides.siteId, sites.id))
        .where(eq(articleOverrides.articleId, input.articleId))
        .orderBy(asc(sites.name));
    }),

  listForSite: authProcedure
    .input(z.object({ siteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: articleOverrides.id,
          articleId: articleOverrides.articleId,
          siteId: articleOverrides.siteId,
          articleTitle: articles.title,
          articleKbNumber: articles.kbNumber,
          type: articleOverrides.type,
          title: articleOverrides.title,
          contentText: articleOverrides.contentText,
          createdAt: articleOverrides.createdAt,
          updatedAt: articleOverrides.updatedAt
        })
        .from(articleOverrides)
        .innerJoin(articles, eq(articleOverrides.articleId, articles.id))
        .where(eq(articleOverrides.siteId, input.siteId))
        .orderBy(desc(articleOverrides.updatedAt));
    }),

  create: authProcedure
    .input(
      z.object({
        articleId: z.string().uuid(),
        siteId: z.string().uuid(),
        type: z.enum(['addendum', 'replacement', 'note']),
        title: z.string().min(1),
        contentJson: z.any(),
        contentText: z.string()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(articleOverrides)
        .values({
          articleId: input.articleId,
          siteId: input.siteId,
          type: input.type,
          title: input.title,
          contentJson: input.contentJson,
          contentText: input.contentText,
          createdBy: ctx.user.id
        })
        .returning();

      if (!row) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create override'
        });
      }

      const [site] = await ctx.db
        .select({ name: sites.name })
        .from(sites)
        .where(eq(sites.id, row.siteId))
        .limit(1);

      return { ...row, siteName: site?.name ?? '' };
    }),

  update: authProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        type: z.enum(['addendum', 'replacement', 'note']).optional(),
        title: z.string().min(1).optional(),
        contentJson: z.any().optional(),
        contentText: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      const values: Record<string, unknown> = { updatedAt: sql`now()` };
      if (patch.type !== undefined) values.type = patch.type;
      if (patch.title !== undefined) values.title = patch.title;
      if (patch.contentJson !== undefined) values.contentJson = patch.contentJson;
      if (patch.contentText !== undefined) values.contentText = patch.contentText;

      const [row] = await ctx.db
        .update(articleOverrides)
        .set(values)
        .where(eq(articleOverrides.id, id))
        .returning();

      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });

      const [site] = await ctx.db
        .select({ name: sites.name })
        .from(sites)
        .where(eq(sites.id, row.siteId))
        .limit(1);

      return { ...row, siteName: site?.name ?? '' };
    }),

  remove: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(articleOverrides).where(eq(articleOverrides.id, input.id));
      return { success: true };
    })
});

// ── Versions ──────────────────────────────────────────────

const versionsRouter = t.router({
  listForArticle: authProcedure
    .input(z.object({ articleId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({
          id: articleVersions.id,
          versionNumber: articleVersions.versionNumber,
          title: articleVersions.title,
          changeNote: articleVersions.changeNote,
          createdById: createdByUser.id,
          createdByName: createdByUser.name,
          createdAt: articleVersions.createdAt
        })
        .from(articleVersions)
        .leftJoin(createdByUser, eq(articleVersions.createdBy, createdByUser.id))
        .where(eq(articleVersions.articleId, input.articleId))
        .orderBy(desc(articleVersions.versionNumber));
    }),

  get: authProcedure
    .input(z.object({ id: z.string().uuid(), articleId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [version] = await ctx.db
        .select({
          id: articleVersions.id,
          articleId: articleVersions.articleId,
          versionNumber: articleVersions.versionNumber,
          title: articleVersions.title,
          changeNote: articleVersions.changeNote,
          contentJson: articleVersions.contentJson,
          contentText: articleVersions.contentText,
          createdById: createdByUser.id,
          createdByName: createdByUser.name,
          createdAt: articleVersions.createdAt
        })
        .from(articleVersions)
        .leftJoin(createdByUser, eq(articleVersions.createdBy, createdByUser.id))
        .where(and(eq(articleVersions.id, input.id), eq(articleVersions.articleId, input.articleId)))
        .limit(1);

      if (!version) throw new TRPCError({ code: 'NOT_FOUND' });

      return {
        id: version.id,
        articleId: version.articleId,
        versionNumber: version.versionNumber,
        title: version.title,
        changeNote: version.changeNote,
        contentJson: version.contentJson,
        contentText: version.contentText,
        createdBy: version.createdById
          ? { id: version.createdById, name: version.createdByName ?? '' }
          : null,
        createdAt: version.createdAt
      };
    })
});

// ── Edit Locks ────────────────────────────────────────────

const locksRouter = t.router({
  acquire: authProcedure
    .input(
      z.object({
        resourceType: z.enum(['article', 'override']),
        resourceId: z.string().uuid()
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check for existing non-expired lock by another user
      const [existing] = await ctx.db
        .select()
        .from(editLocks)
        .where(
          and(
            eq(editLocks.resourceType, input.resourceType),
            eq(editLocks.resourceId, input.resourceId),
            sql`${editLocks.expiresAt} > now()`
          )
        )
        .limit(1);

      if (existing && existing.lockedBy !== ctx.user.id) {
        const [lockedUser] = await ctx.db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, existing.lockedBy))
          .limit(1);

        throw new TRPCError({
          code: 'CONFLICT',
          message: `Locked by ${lockedUser?.name ?? 'another user'}`
        });
      }

      // Upsert lock
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      if (existing) {
        const [row] = await ctx.db
          .update(editLocks)
          .set({ lockedBy: ctx.user.id, expiresAt, lockedAt: sql`now()` })
          .where(
            and(
              eq(editLocks.resourceType, input.resourceType),
              eq(editLocks.resourceId, input.resourceId)
            )
          )
          .returning();
        return row!;
      }

      const [row] = await ctx.db
        .insert(editLocks)
        .values({
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          lockedBy: ctx.user.id,
          expiresAt
        })
        .returning();

      return row!;
    }),

  release: authProcedure
    .input(
      z.object({
        resourceType: z.enum(['article', 'override']),
        resourceId: z.string().uuid()
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(editLocks)
        .where(
          and(
            eq(editLocks.resourceType, input.resourceType),
            eq(editLocks.resourceId, input.resourceId),
            eq(editLocks.lockedBy, ctx.user.id)
          )
        );
      return { success: true };
    }),

  heartbeat: authProcedure
    .input(
      z.object({
        resourceType: z.enum(['article', 'override']),
        resourceId: z.string().uuid()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

      const [row] = await ctx.db
        .update(editLocks)
        .set({ expiresAt })
        .where(
          and(
            eq(editLocks.resourceType, input.resourceType),
            eq(editLocks.resourceId, input.resourceId),
            eq(editLocks.lockedBy, ctx.user.id)
          )
        )
        .returning();

      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'No active lock found' });
      return row;
    })
});

// ── Combined Wiki Router ──────────────────────────────────

export const wikiRouter = t.router({
  contexts: contextsRouter,
  articles: articlesRouter,
  drafts: draftsRouter,
  tags: tagsRouter,
  overrides: overridesRouter,
  versions: versionsRouter,
  locks: locksRouter
});
