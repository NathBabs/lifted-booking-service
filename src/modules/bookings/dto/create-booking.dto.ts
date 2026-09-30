import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsCalendarDay } from '../../../common/decorators/is-calendar-day.decorator';
import { VisaType } from '../../../database';

export class CreateBookingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  candidateName!: string;

  @IsEnum(VisaType)
  visaType!: VisaType;

  // The day the candidate wants; they get the earliest free slot on it.
  @IsCalendarDay()
  date!: string;
}
