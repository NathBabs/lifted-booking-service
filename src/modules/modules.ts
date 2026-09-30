import { Module } from '@nestjs/common';
import { AvailabilityModule } from './availability/availability.module';
import { BookingsModule } from './bookings/bookings.module';
import { WaitlistModule } from './waitlist/waitlist.module';

@Module({
  imports: [AvailabilityModule, BookingsModule, WaitlistModule],
  exports: [],
})
export class Modules {}
