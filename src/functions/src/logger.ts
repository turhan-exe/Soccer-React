import * as functions from 'firebase-functions';
import { v4 as uuidv4 } from 'uuid';

type Level = 'debug' | 'info' | 'warn' | 'error';

export interface LogCtx {
  requestId?: string;
  matchId?: string;
  leagueId?: string;
  function?: string;
  stage?: string;        // schedule | start | live | finalize | monitor
  durationMs?: number;
  errorClass?: string;
  ok?: boolean;
  extra?: Record<string, unknown>;
  [k: string]: unknown;
}

function write(level: Level, msg: string, ctx?: LogCtx) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...ctx,
    requestId: ctx?.requestId || uuidv4(),
  } as const;

  switch (level) {
    case 'debug': functions.logger.debug(payload); break;
    case 'info':  functions.logger.info(payload);  break;
    case 'warn':  functions.logger.warn(payload);  break;
    case 'error': functions.logger.error(payload); break;
  }
  return payload.requestId;
}

export const log = {
  debug: (msg: string, ctx?: LogCtx) => write('debug', msg, ctx),
  info:  (msg: string, ctx?: LogCtx) => write('info',  msg, ctx),
  warn:  (msg: string, ctx?: LogCtx) => write('warn',  msg, ctx),
  error: (msg: string, ctx?: LogCtx) => write('error', msg, ctx),
};

