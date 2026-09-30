import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Booking } from '../../database';
import { AvailabilityModule } from '../availability/availability.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { HoldExpiryJob } from './hold-expiry.job';

@Module({
  imports: [
    AvailabilityModule,
    WaitlistModule,
    TypeOrmModule.forFeature([Booking]),
  ],
  controllers: [BookingsController],
  providers: [BookingsService, HoldExpiryJob],
})
export class BookingsModule {}
