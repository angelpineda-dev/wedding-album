#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/5c84b3346109e970efa868863448af1442af595e95d8ba70a3486d48d4a77e09/contract';
import startContract from '../../snapshots/5c84b3346109e970efa868863448af1442af595e95d8ba70a3486d48d4a77e09/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/82b62bd1be6ab83e06eb3aa13c336476355b7d21977d168fb541e109001319ae/contract';
import endContract from '../../snapshots/82b62bd1be6ab83e06eb3aa13c336476355b7d21977d168fb541e109001319ae/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  lit,
  primaryKey,
  sql,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'magic_links',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('expiresAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tokenHash', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('usedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('userId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('eventQuota', 'int4', {
          notNull: true,
          default: lit(1),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'users',
        column: col('status', 'text', {
          notNull: true,
          default: lit('ACTIVE'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.dropNotNull({ schema: 'public', table: 'users', column: 'password' }),
      this.addUnique({
        schema: 'public',
        table: 'magic_links',
        constraint: 'magic_links_tokenHash_key',
        columns: ['tokenHash'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'users',
        constraint: 'users_status_check_1527ac15',
        expression: sql`"status" IN ('ACTIVE', 'SUSPENDED')`,
      }),
      this.createIndex({
        schema: 'public',
        table: 'magic_links',
        index: 'magic_links_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'magic_links',
        foreignKey: {
          name: 'magic_links_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
