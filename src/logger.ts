import pino from 'pino';
import { config } from './config.js';

const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.apiKey',
  '*.token',
  'email',
  'customer_email',
];

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: config.OTEL_SERVICE_NAME },
  redact: { paths: redactPaths, censor: '[redacted]' },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function redactPII(text: string): string {
  return text
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:\d[ -]*?){13,16}\b/g, '[card]')
    .replace(/\b\+?\d[\d\s()-]{7,}\b/g, '[phone]');
}
