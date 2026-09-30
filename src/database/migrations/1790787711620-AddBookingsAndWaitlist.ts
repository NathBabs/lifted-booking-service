import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookingsAndWaitlist1790787711620 implements MigrationInterface {
  name = 'AddBookingsAndWaitlist1790787711620';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."visa_type" AS ENUM('A', 'B')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."booking_status" AS ENUM('HELD', 'CONFIRMED', 'EXPIRED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."confirmation_required_by" AS ENUM('ADVISOR', 'CANDIDATE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "bookings" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "advisor_id" character varying(25) NOT NULL, "candidate_name" character varying(100) NOT NULL, "visa_type" "public"."visa_type" NOT NULL, "start_at" TIMESTAMP WITH TIME ZONE NOT NULL, "end_at" TIMESTAMP WITH TIME ZONE NOT NULL, "status" "public"."booking_status" NOT NULL DEFAULT 'HELD', "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "confirmation_required_by" "public"."confirmation_required_by" NOT NULL DEFAULT 'ADVISOR', "confirmed_at" TIMESTAMP WITH TIME ZONE, "cancelled_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_bee6805982cc1e248e94ce94957" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0a69ec1e2efabbeb2977fbcc48" ON "bookings"  ("status", "expires_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9d85ba7388c832d52da2566dd8" ON "bookings"  ("advisor_id", "start_at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."waitlist_visa_type" AS ENUM('A', 'B')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."waitlist_status" AS ENUM('WAITING', 'OFFERED', 'FULFILLED', 'CANCELLED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "waitlist_entries" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "candidate_name" character varying(100) NOT NULL, "visa_type" "public"."waitlist_visa_type" NOT NULL, "status" "public"."waitlist_status" NOT NULL DEFAULT 'WAITING', "offered_booking_id" uuid, CONSTRAINT "REL_ab12dc7f782c764c1ef1af78da" UNIQUE ("offered_booking_id"), CONSTRAINT "PK_bd0ef66fff81d3be7b7a1568a4d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4232fd7fdad07f8ff3fd0304ce" ON "waitlist_entries"  ("status", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "bookings" ADD CONSTRAINT "FK_a93ef6910e39e1ef56c78d8e201" FOREIGN KEY ("advisor_id") REFERENCES "advisors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "waitlist_entries" ADD CONSTRAINT "FK_ab12dc7f782c764c1ef1af78da2" FOREIGN KEY ("offered_booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "waitlist_entries" DROP CONSTRAINT "FK_ab12dc7f782c764c1ef1af78da2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bookings" DROP CONSTRAINT "FK_a93ef6910e39e1ef56c78d8e201"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4232fd7fdad07f8ff3fd0304ce"`,
    );
    await queryRunner.query(`DROP TABLE "waitlist_entries"`);
    await queryRunner.query(`DROP TYPE "public"."waitlist_status"`);
    await queryRunner.query(`DROP TYPE "public"."waitlist_visa_type"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9d85ba7388c832d52da2566dd8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0a69ec1e2efabbeb2977fbcc48"`,
    );
    await queryRunner.query(`DROP TABLE "bookings"`);
    await queryRunner.query(`DROP TYPE "public"."confirmation_required_by"`);
    await queryRunner.query(`DROP TYPE "public"."booking_status"`);
    await queryRunner.query(`DROP TYPE "public"."visa_type"`);
  }
}
