import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1790767157047 implements MigrationInterface {
  name = 'InitSchema1790767157047';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "availability_windows" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "advisor_id" character varying(25) NOT NULL, "start_at" TIMESTAMP WITH TIME ZONE NOT NULL, "end_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "UQ_400f382891feb863ef83f1002f6" UNIQUE ("advisor_id", "start_at"), CONSTRAINT "PK_2b90591d83bf13eb2a2667d49ed" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "advisors" ("created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "id" character varying(25) NOT NULL, "name" character varying(100) NOT NULL, CONSTRAINT "PK_4baf808487b3dcc389087c9cdeb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "availability_windows" ADD CONSTRAINT "FK_675b812c8cea205d585b3c893ac" FOREIGN KEY ("advisor_id") REFERENCES "advisors"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "availability_windows" DROP CONSTRAINT "FK_675b812c8cea205d585b3c893ac"`,
    );
    await queryRunner.query(`DROP TABLE "advisors"`);
    await queryRunner.query(`DROP TABLE "availability_windows"`);
  }
}
