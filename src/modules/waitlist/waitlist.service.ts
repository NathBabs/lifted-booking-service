import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  And,
  DataSource,
  EntityManager,
  In,
  LessThan,
  LessThanOrEqual,
  MoreThan,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { utcDayBounds } from '../../common/utils/utc-day';
import {
  acquireAdvisorLocks,
  Booking,
  BookingStatus,
  ConfirmationRequiredBy,
  VisaType,
  WaitlistEntry,
  WaitlistStatus,
} from '../../database';
import {
  AvailabilityService,
  AvailableSlot,
} from '../availability/availability.service';
import { holdSlot } from '../bookings/hold-slot';

export interface JoinWaitlistInput {
  candidateName: string;
  visaType: VisaType;
  requestedDate: string;
}

export interface ReconcileResult {
  expiredHolds: number;
  offers: WaitlistEntry[];
}

@Injectable()
export class WaitlistService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly availabilityService: AvailabilityService,
    @InjectRepository(WaitlistEntry)
    private readonly waitlistRepo: Repository<WaitlistEntry>,
  ) {}

  // Runs inside the booking request's transaction, under the day's advisor locks.
  join(
    manager: EntityManager,
    input: JoinWaitlistInput,
  ): Promise<WaitlistEntry> {
    return manager.save(
      manager.create(WaitlistEntry, {
        ...input,
        status: WaitlistStatus.WAITING,
      }),
    );
  }

  findAll(): Promise<WaitlistEntry[]> {
    return this.waitlistRepo.find({
      order: { requestedDate: 'ASC', createdAt: 'ASC', id: 'ASC' },
    });
  }

  // Settles a day after capacity may have been released: expires lapsed holds,
  // closes their offers, then hands any freed capacity to the queue.
  // Caller must already hold the day's advisor locks.
  async reconcileDate(
    manager: EntityManager,
    date: string,
    now: Date,
  ): Promise<ReconcileResult> {
    const { start, end } = utcDayBounds(date);

    const expired = await manager.update(
      Booking,
      {
        status: BookingStatus.HELD,
        expiresAt: LessThanOrEqual(now),
        startAt: And(MoreThanOrEqual(start), LessThan(end)),
      },
      { status: BookingStatus.EXPIRED },
      { returning: ['id'] },
    );
    const expiredIds = (expired.raw as { id: string }[]).map((row) => row.id);

    // Their candidates leave the queue, otherwise the oldest would be offered
    // the same slot again forever.
    if (expiredIds.length > 0) {
      await manager.update(
        WaitlistEntry,
        { offeredBookingId: In(expiredIds), status: WaitlistStatus.OFFERED },
        { status: WaitlistStatus.EXPIRED },
      );
    }

    // One offer per pass, recalculating in between, since each new hold and
    // its break changes what fits next.
    const offers: WaitlistEntry[] = [];
    for (;;) {
      const offer = await this.offerNextSlot(manager, date, now);
      if (!offer) return { expiredHolds: expiredIds.length, offers };
      offers.push(offer);
    }
  }

  // A booking cancelled directly takes its waitlist offer with it.
  async withdrawOffer(manager: EntityManager, bookingId: string) {
    await manager.update(
      WaitlistEntry,
      { offeredBookingId: bookingId, status: WaitlistStatus.OFFERED },
      { status: WaitlistStatus.CANCELLED },
    );
  }

  // The candidate takes the offered slot. Same lock and checks as advisor
  // confirmation, but for CANDIDATE holds.
  async accept(
    id: string,
  ): Promise<{ waitlistEntry: WaitlistEntry; booking: Booking }> {
    return this.dataSource.transaction(async (manager) => {
      const entry = await manager.findOneBy(WaitlistEntry, { id });
      if (!entry) throw new NotFoundException(`Waitlist entry ${id} not found`);
      if (!entry.offeredBookingId) {
        throw new ConflictException(`Waitlist entry is ${entry.status}`);
      }

      const offered = await manager.findOneByOrFail(Booking, {
        id: entry.offeredBookingId,
      });
      await acquireAdvisorLocks(manager, [offered.advisorId]);
      const now = new Date();

      const { affected } = await manager.update(
        Booking,
        {
          id: offered.id,
          status: BookingStatus.HELD,
          confirmationRequiredBy: ConfirmationRequiredBy.CANDIDATE,
          expiresAt: MoreThan(now),
        },
        { status: BookingStatus.CONFIRMED, confirmedAt: now },
      );
      if (!affected) {
        const current = await manager.findOneByOrFail(WaitlistEntry, { id });
        throw new ConflictException(
          current.status === WaitlistStatus.FULFILLED
            ? 'Offer already accepted'
            : 'The offer has expired or was withdrawn',
        );
      }

      await manager.update(
        WaitlistEntry,
        { id, status: WaitlistStatus.OFFERED },
        { status: WaitlistStatus.FULFILLED },
      );

      return {
        waitlistEntry: await manager.findOneByOrFail(WaitlistEntry, { id }),
        booking: await manager.findOneByOrFail(Booking, { id: offered.id }),
      };
    });
  }

  // Leaving the queue, or declining an offer. Declining releases the held slot,
  // so the day gets reconciled like any other cancellation.
  async cancel(id: string): Promise<WaitlistEntry> {
    return this.dataSource.transaction(async (manager) => {
      const entry = await manager.findOneBy(WaitlistEntry, { id });
      if (!entry) throw new NotFoundException(`Waitlist entry ${id} not found`);

      await this.availabilityService.lockAdvisorsForDate(
        manager,
        entry.requestedDate,
      );
      const now = new Date();

      // Re-read under the lock; the allocator may have made an offer meanwhile.
      const current = await manager.findOneByOrFail(WaitlistEntry, { id });

      if (current.status === WaitlistStatus.WAITING) {
        await manager.update(
          WaitlistEntry,
          { id },
          { status: WaitlistStatus.CANCELLED },
        );
      } else if (
        current.status === WaitlistStatus.OFFERED &&
        current.offeredBookingId
      ) {
        await manager.update(
          WaitlistEntry,
          { id },
          { status: WaitlistStatus.CANCELLED },
        );
        await manager.update(
          Booking,
          { id: current.offeredBookingId, status: BookingStatus.HELD },
          { status: BookingStatus.CANCELLED, cancelledAt: now },
        );
        await this.reconcileDate(manager, current.requestedDate, now);
      } else {
        throw new ConflictException(
          `Waitlist entry is already ${current.status}`,
        );
      }

      return manager.findOneByOrFail(WaitlistEntry, { id });
    });
  }

  // Oldest first. Offers the first entry whose visa type fits somewhere that
  // day; entries that don't fit keep their place.
  private async offerNextSlot(
    manager: EntityManager,
    date: string,
    now: Date,
  ): Promise<WaitlistEntry | null> {
    const waiting = await manager.find(WaitlistEntry, {
      where: { requestedDate: date, status: WaitlistStatus.WAITING },
      order: { createdAt: 'ASC', id: 'ASC' },
    });

    const firstSlotByType = new Map<VisaType, AvailableSlot | undefined>();

    for (const entry of waiting) {
      if (!firstSlotByType.has(entry.visaType)) {
        const [slot] = await this.availabilityService.getAvailableSlots(
          entry.visaType,
          date,
          { now, manager, lockAdvisors: true },
        );
        firstSlotByType.set(entry.visaType, slot);
      }

      const slot = firstSlotByType.get(entry.visaType);
      if (!slot) continue;

      const booking = await holdSlot(manager, {
        slot,
        candidateName: entry.candidateName,
        visaType: entry.visaType,
        confirmationRequiredBy: ConfirmationRequiredBy.CANDIDATE,
        now,
      });
      const offer = {
        status: WaitlistStatus.OFFERED,
        offeredBookingId: booking.id,
        offeredAt: now,
      };
      await manager.update(
        WaitlistEntry,
        { id: entry.id, status: WaitlistStatus.WAITING },
        offer,
      );
      return { ...entry, ...offer };
    }

    return null;
  }
}
