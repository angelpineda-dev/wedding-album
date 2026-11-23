#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/29921458bf4541c640e9a7d1d26a5a928fc65aea57dfbede618315b1f7aa99cd/contract';
import endContract from '../../snapshots/29921458bf4541c640e9a7d1d26a5a928fc65aea57dfbede618315b1f7aa99cd/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/82b62bd1be6ab83e06eb3aa13c336476355b7d21977d168fb541e109001319ae/contract';
import startContract from '../../snapshots/82b62bd1be6ab83e06eb3aa13c336476355b7d21977d168fb541e109001319ae/contract.json' with { type: 'json' };
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
        table: 'events',
        columns: [
          col('closesAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('createdAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('enabledAt', 'timestamptz(3)', {
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('galleryPollSeconds', 'int4', {
            notNull: true,
            default: lit(120),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('geofenceEnabled', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('latitude', 'float8', { codecRef: { codecId: 'pg/float8@1' } }),
          col('longitude', 'float8', { codecRef: { codecId: 'pg/float8@1' } }),
          col('moderationRequired', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('opensAt', 'timestamptz(3)', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('ownerId', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('packageMax', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
          col('publicCode', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('radiusMeters', 'int4', {
            notNull: true,
            default: lit(5000),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('PENDING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('timezone', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', {
            notNull: true,
            default: lit('WEDDING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
          col('updatedAt', 'timestamptz(3)', {
            notNull: true,
            default: fn(sql`now()`),
            codecRef: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
          }),
          col('venueName', 'text', { codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'events_status_check_b4fb90c1',
            sql`"status" IN ('PENDING', 'ENABLED', 'SUSPENDED')`,
          ),
          checkExpression('events_type_check_b749e837', sql`"type" IN ('WEDDING')`),
        ],
      }),
      this.addUnique({
        schema: 'public',
        table: 'events',
        constraint: 'events_publicCode_key',
        columns: ['publicCode'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'events',
        index: 'events_ownerId_idx_e2d0c1ef',
        columns: ['ownerId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'events',
        index: 'events_status_idx_e98638ab',
        columns: ['status'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'events',
        foreignKey: {
          name: 'events_ownerId_fkey',
          columns: ['ownerId'],
          references: { schema: 'public', table: 'users', columns: ['id'] },
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
