#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/29921458bf4541c640e9a7d1d26a5a928fc65aea57dfbede618315b1f7aa99cd/contract';
import startContract from '../../snapshots/29921458bf4541c640e9a7d1d26a5a928fc65aea57dfbede618315b1f7aa99cd/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/812f50e38908e6ff0c8930f575542dbe6d36683a628762edda77ce979e666d5b/contract';
import endContract from '../../snapshots/812f50e38908e6ff0c8930f575542dbe6d36683a628762edda77ce979e666d5b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey, sql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'guests',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('eventId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('expiresAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lastSeenAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tokenHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'guests',
        constraint: 'guests_tokenHash_key',
        columns: ['tokenHash'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'guests',
        index: 'guests_eventId_idx_6a266d47',
        columns: ['eventId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'guests',
        foreignKey: {
          name: 'guests_eventId_fkey',
          columns: ['eventId'],
          references: { schema: 'public', table: 'events', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
