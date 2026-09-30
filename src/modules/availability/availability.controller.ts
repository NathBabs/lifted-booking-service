import { Controller, Get, Query } from '@nestjs/common';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AvailabilityService } from './availability.service';
import { GetAvailabilityQueryDto } from './dto/get-availability.query.dto';

@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get()
  @ResponseMessage('Availability retrieved successfully')
  async getAvailability(@Query() { visaType, date }: GetAvailabilityQueryDto) {
    const slots = await this.availabilityService.getAvailableSlots(
      visaType,
      date,
    );

    return { visaType, date, total: slots.length, slots };
  }
}
