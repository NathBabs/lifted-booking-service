import { IsEnum } from 'class-validator';
import { IsCalendarDay } from '../../../common/decorators/is-calendar-day.decorator';
import { VisaType } from '../../../database';

export class GetAvailabilityQueryDto {
  @IsEnum(VisaType)
  visaType!: VisaType;

  @IsCalendarDay()
  date!: string;
}
