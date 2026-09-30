import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { Advisor } from '../entities/advisor.entity';
import { AvailabilityWindow } from '../entities/availability-window.entity';
import { AdvisorDataDto } from './dto/seed.dto';

const ADVISORS_DATA_FILE_PATH = path.join(
  __dirname,
  '../../assets/advisors-data.json',
);

@Injectable()
export class SeederService {
  private readonly logger = new Logger(SeederService.name);

  constructor(private readonly dataSource: DataSource) {}

  async seed(): Promise<void> {
    this.logger.log(
      '::: Starting seeding of Advisors and Availability Windows :::',
    );

    try {
      const { advisors } = await this.loadAdvisorData();

      await this.dataSource.transaction(async (manager) => {
        // ON CONFLICT DO NOTHING (against the advisors PK and the
        // unique(advisor_id, start_at) on windows) makes re-running idempotent.
        const insertedAdvisors = await manager
          .createQueryBuilder()
          .insert()
          .into(Advisor)
          .values(advisors.map(({ id, name }) => ({ id, name })))
          .orIgnore()
          .returning(['id'])
          .updateEntity(false)
          .execute();

        const windows = advisors.flatMap((advisor) =>
          advisor.availability.map((window) => ({
            advisorId: advisor.id,
            startAt: new Date(window.start),
            endAt: new Date(window.end),
          })),
        );

        const insertedWindows = await manager
          .createQueryBuilder()
          .insert()
          .into(AvailabilityWindow)
          .values(windows)
          .orIgnore()
          .returning(['id'])
          .updateEntity(false)
          .execute();

        const advisorCount = (insertedAdvisors.raw as unknown[]).length;
        const windowCount = (insertedWindows.raw as unknown[]).length;
        const skippedSome =
          advisorCount < advisors.length || windowCount < windows.length;

        this.logger.log(
          `::: Seeded ${advisorCount} of ${advisors.length} advisors and ${windowCount} of ${windows.length} availability windows${skippedSome ? ' (the rest already existed)' : ''} :::`,
        );
      });
    } catch (error) {
      this.logger.error(
        '::: Seeding failed, no changes were committed :::',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  private async loadAdvisorData(): Promise<AdvisorDataDto> {
    const data = await readFile(ADVISORS_DATA_FILE_PATH, 'utf-8');

    let parsedData: unknown;
    try {
      parsedData = JSON.parse(data);
    } catch (error) {
      throw new Error(
        `Advisor data file is not valid JSON, please review and fix: ${ADVISORS_DATA_FILE_PATH}`,
        { cause: error },
      );
    }

    return this.validateAdvisorData(parsedData);
  }

  private async validateAdvisorData(
    parsedData: unknown,
  ): Promise<AdvisorDataDto> {
    // the file should contain a single JSON object, not an array or a bare value
    if (
      typeof parsedData !== 'object' ||
      parsedData === null ||
      Array.isArray(parsedData)
    ) {
      throw new Error('Advisor data file must contain a JSON object');
    }

    const advisorData = plainToInstance(AdvisorDataDto, parsedData);

    const errors = await validate(advisorData, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (errors.length > 0) {
      const details = errors
        .map((error) => error.toString(false, false, '', true))
        .join('');
      throw new Error(
        `Advisor data structure or date windows are invalid:\n${details}`,
      );
    }

    return advisorData;
  }
}
