import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { toUtcDate } from '../../common/utils/utc-day';
import {
  acquireAdvisorLocks,
  Booking,
  BookingStatus,
  ConfirmationRequiredBy,
  WaitlistEntry,
} from '../../database';
import { AvailabilityService } from '../availability/availability.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { effectiveStatus } from './booking-status';
import { CreateBookingDto } from './dto/create-booking.dto';
import { holdSlot } from './hold-slot';

export type BookingRequestResult =
  | { outcome: 'HELD'; booking: Booking }
  | { outcome: 'WAITLISTED'; waitlistEntry: WaitlistEntry };

@Injectable()
export class BookingsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly availabilityService: AvailabilityService,
    private readonly waitlistService: WaitlistService,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
  ) {}

  async findAll(now = new Date()): Promise<Booking[]> {
    const bookings = await this.bookingRepo.find({
      order: { startAt: 'ASC', advisorId: 'ASC' },
    });

    return bookings.map((booking) => ({
      ...booking,
      status: effectiveStatus(booking, now),
    }));
  }

  async confirm(id: string): Promise<Booking> {
    return this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(Booking);

      const booking = await bookingRepo.findOneBy({ id });
      if (!booking) throw new NotFoundException(`Booking ${id} not found`);

      // Same lock as requestBooking, so a new hold can't be placed over this
      // one while we're confirming it.
      await acquireAdvisorLocks(manager, [booking.advisorId]);

      // Read the clock after the lock. We may have waited on it, and a stale
      // time could let a just-lapsed hold through.
      const now = new Date();

      const { affected } = await bookingRepo.update(
        {
          id,
          status: BookingStatus.HELD,
          confirmationRequiredBy: ConfirmationRequiredBy.ADVISOR,
          expiresAt: MoreThan(now),
        },
        { status: BookingStatus.CONFIRMED, confirmedAt: now },
      );

      const current = await bookingRepo.findOneByOrFail({ id });
      if (!affected) {
        throw new ConflictException(whyNotConfirmable(current, now));
      }
      return current;
    });
  }

  // Cancelling releases capacity that goes straight to the waitlist, so this
  // takes the whole day's locks like any other reallocation.
  async cancel(id: string): Promise<Booking> {
    return this.dataSource.transaction(async (manager) => {
      const bookingRepo = manager.getRepository(Booking);

      const booking = await bookingRepo.findOneBy({ id });
      if (!booking) throw new NotFoundException(`Booking ${id} not found`);

      const date = toUtcDate(booking.startAt);
      await this.availabilityService.lockAdvisorsForDate(manager, date);
      const now = new Date();

      const { affected } = await bookingRepo.update(
        [
          { id, status: BookingStatus.CONFIRMED },
          { id, status: BookingStatus.HELD, expiresAt: MoreThan(now) },
        ],
        { status: BookingStatus.CANCELLED, cancelledAt: now },
      );

      const current = await bookingRepo.findOneByOrFail({ id });
      if (!affected) {
        throw new ConflictException(
          `Booking is already ${effectiveStatus(current, now)}`,
        );
      }

      await this.waitlistService.withdrawOffer(manager, id);
      await this.waitlistService.reconcileDate(manager, date, now);
      return current;
    });
  }

  // Under the day's locks: settle the queue first, so a newcomer can't take
  // capacity someone is already waiting for, then serve the newcomer. No slot
  // means they join the queue.
  async requestBooking(
    { candidateName, visaType, date }: CreateBookingDto,
    now = new Date(),
  ): Promise<BookingRequestResult> {
    return this.dataSource.transaction(async (manager) => {
      await this.availabilityService.lockAdvisorsForDate(manager, date);
      await this.waitlistService.reconcileDate(manager, date, now);

      const [slot] = await this.availabilityService.getAvailableSlots(
        visaType,
        date,
        { now, manager, lockAdvisors: true },
      );

      if (!slot) {
        const waitlistEntry = await this.waitlistService.join(manager, {
          candidateName,
          visaType,
          requestedDate: date,
        });
        return { outcome: 'WAITLISTED', waitlistEntry };
      }

      const booking = await holdSlot(manager, {
        slot,
        candidateName,
        visaType,
        confirmationRequiredBy: ConfirmationRequiredBy.ADVISOR,
        now,
      });
      return { outcome: 'HELD', booking };
    });
  }
}

function whyNotConfirmable(booking: Booking, now: Date): string {
  const status = effectiveStatus(booking, now);
  if (status === BookingStatus.EXPIRED) return 'The hold has expired';
  // Still a live hold, so it's one only the candidate can confirm.
  if (status === BookingStatus.HELD) {
    return 'This hold must be confirmed by the candidate';
  }
  return `Booking is already ${status}`;
}
