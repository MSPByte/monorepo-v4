import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context.js';

export const t = initTRPC.context<Context>().create();

const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.userId || !ctx.db) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { ...ctx, userId: ctx.userId, db: ctx.db } });
});

export const authProcedure = t.procedure.use(isAuthed);
