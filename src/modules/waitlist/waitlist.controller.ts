import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { WaitlistService } from './waitlist.service';

@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @Get()
  @ResponseMessage('Waitlist retrieved successfully')
  async findAll() {
    const entries = await this.waitlistService.findAll();
    return { total: entries.length, entries };
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Offer accepted, booking confirmed')
  accept(@Param('id', ParseUUIDPipe) id: string) {
    return this.waitlistService.accept(id);
  }

  // Leaves the queue, or declines an outstanding offer.
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Waitlist entry cancelled')
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.waitlistService.cancel(id);
  }
}
