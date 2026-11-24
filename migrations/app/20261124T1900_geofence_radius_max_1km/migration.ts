#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/a0e2aa05c080453838e5d153479ce276ba1939f041a453eb42931a7baa2bdb6d/contract';
import endContract from '../../snapshots/a0e2aa05c080453838e5d153479ce276ba1939f041a453eb42931a7baa2bdb6d/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/b6f36e9756411faa78ac24cf6b442efad20aed906607ea03eb8ac570352f8622/contract';
import startContract from '../../snapshots/b6f36e9756411faa78ac24cf6b442efad20aed906607ea03eb8ac570352f8622/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit, rawSql } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // Geofences are capped at 1 km (RADIUS_METERS.MAX). Existing wider ones shrink to the cap
      // so every stored event satisfies the API's validation on its next edit.
      rawSql({
        id: 'data.events.radiusMeters.cap1km',
        label: 'Cap "events"."radiusMeters" at 1000',
        operationClass: 'data',
        target: { id: 'postgres', details: { schema: 'public', objectType: 'column', name: 'radiusMeters', table: 'events' } },
        precheck: [],
        execute: [
          {
            description: 'cap geofence radius at 1000 m',
            sql: 'UPDATE "public"."events" SET "radiusMeters" = 1000 WHERE "radiusMeters" > 1000',
          },
        ],
        postcheck: [],
      }),
      this.setDefault({
        schema: 'public',
        table: 'events',
        column: col('radiusMeters', 'int4', {
          default: lit(300),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
