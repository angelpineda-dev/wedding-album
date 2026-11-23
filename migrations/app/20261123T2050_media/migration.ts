#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/812f50e38908e6ff0c8930f575542dbe6d36683a628762edda77ce979e666d5b/contract';
import startContract from '../../snapshots/812f50e38908e6ff0c8930f575542dbe6d36683a628762edda77ce979e666d5b/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/b6f36e9756411faa78ac24cf6b442efad20aed906607ea03eb8ac570352f8622/contract';
import endContract from '../../snapshots/b6f36e9756411faa78ac24cf6b442efad20aed906607ea03eb8ac570352f8622/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
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
        table: 'media',
        columns: [
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('eventId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('guestId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mimeType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('moderatedById', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('publishedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('sizeBytes', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('status', 'text', {
            notNull: true,
            default: lit('UPLOADING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('storageKey', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('uploadedAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('media_kind_check_9979bd59', sql`"kind" IN ('PHOTO', 'VIDEO')`),
          checkExpression(
            'media_status_check_5ee79b2a',
            sql`"status" IN ('UPLOADING', 'PENDING', 'PUBLISHED', 'HIDDEN')`,
          ),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'media',
        constraint: 'media_storageKey_key',
        columns: ['storageKey'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'media',
        index: 'media_eventId_idx_6a266d47',
        columns: ['eventId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'media',
        index: 'media_eventId_status_idx_c51df527',
        columns: ['eventId', 'status'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'media',
        index: 'media_guestId_idx_39c95865',
        columns: ['guestId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'media',
        index: 'media_moderatedById_idx_4b155aa3',
        columns: ['moderatedById'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'media',
        foreignKey: {
          name: 'media_eventId_fkey',
          columns: ['eventId'],
          references: { schema: 'public', table: 'events', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'media',
        foreignKey: {
          name: 'media_guestId_fkey',
          columns: ['guestId'],
          references: { schema: 'public', table: 'guests', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'media',
        foreignKey: {
          name: 'media_moderatedById_fkey',
          columns: ['moderatedById'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
