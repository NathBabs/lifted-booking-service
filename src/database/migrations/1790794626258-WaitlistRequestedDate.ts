import { MigrationInterface, QueryRunner } from 'typeorm';

export class WaitlistRequestedDate1790794626258 implements MigrationInterface {
  name = 'WaitlistRequestedDate1790794626258';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4232fd7fdad07f8ff3fd0304ce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "waitlist_entries" ADD "requested_date" date NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "waitlist_entries" ADD "offered_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."waitlist_status" ADD VALUE 'EXPIRED'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_204ec4871e2e8416caa4248df7" ON "waitlist_entries"  ("requested_date", "status", "created_at") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_204ec4871e2e8416caa4248df7"`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."waitlist_status_old" AS ENUM('WAITING', 'OFFERED', 'FULFILLED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `ALTER TABLE "waitlist_entries" ALTER COLUMN "status" TYPE "public"."waitlist_status_old" USING "status"::"text"::"public"."waitlist_status_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."waitlist_status"`);
    await queryRunner.query(
      `ALTER TYPE "public"."waitlist_status_old" RENAME TO "waitlist_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "waitlist_entries" DROP COLUMN "offered_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "waitlist_entries" DROP COLUMN "requested_date"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4232fd7fdad07f8ff3fd0304ce" ON "waitlist_entries" USING btree ("created_at", "status") `,
    );
  }
}
