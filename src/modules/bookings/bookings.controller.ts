import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  // POST /bookings { candidateName, visaType, date }
  // 201 with a held booking, or 202 when the candidate was waitlisted.
  @Post()
  @ResponseMessage('Booking request processed')
  async requestBooking(
    @Body() dto: CreateBookingDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.bookingsService.requestBooking(dto);
    if (result.outcome === 'WAITLISTED') res.status(HttpStatus.ACCEPTED);
    return result;
  }

  @Get()
  @ResponseMessage('Bookings retrieved successfully')
  async findAll() {
    const bookings = await this.bookingsService.findAll();
    return { total: bookings.length, bookings };
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Booking confirmed')
  confirm(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.confirm(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Booking cancelled')
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookingsService.cancel(id);
  }
}
