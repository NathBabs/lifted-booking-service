import { applyDecorators } from '@nestjs/common';
import { IsISO8601, Matches } from 'class-validator';

export const IsCalendarDay = () =>
  applyDecorators(
    Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' }),
    IsISO8601(
      { strict: true },
      { message: 'date must be a real calendar day' },
    ),
  );
