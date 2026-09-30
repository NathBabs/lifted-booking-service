import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { IsBefore } from '../decorators/is-before.decorator';

export class AdvisorAvailabilityWindowDto {
  @IsDateString()
  @IsBefore('end')
  start!: string;

  @IsDateString()
  end!: string;
}

export class AdvisorDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdvisorAvailabilityWindowDto)
  availability!: AdvisorAvailabilityWindowDto[];
}

export class AdvisorDataDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdvisorDto)
  advisors!: AdvisorDto[];
}
