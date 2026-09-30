import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, LessThan, MoreThan, Repository } from 'typeorm';
import { VISARULES } from '../../common/types/types';
import { utcDayBounds } from '../../common/utils/utc-day';
import {
  acquireAdvisorLocks,
  AvailabilityWindow,
  Booking,
  BookingStatus,
  VisaType,
} from '../../database';
import { calculateSlots } from './slot-calculator';

const MINUTE_MS = 60_000;

const MAX_BUFFER_MS =
  Math.max(...Object.values(VISARULES).map((rule) => rule.buffer)) * MINUTE_MS;

export interface AvailableSlot {
  advisorId: string;
  startAt: Date;
  endAt: Date;
}

@Injectable()
export class AvailabilityService {
  constructor(
    @InjectRepository(AvailabilityWindow)
    private readonly windowRepo: Repository<AvailabilityWindow>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
  ) {}

  // returns bookable slots for a visa type on a UTC date.
  // booking creation can also call this inside its transaction and lock advisors.
  async getAvailableSlots(
    visaType: VisaType,
    date: string,
    {
      now = new Date(),
      manager,
      lockAdvisors = false,
    }: { now?: Date; manager?: EntityManager; lockAdvisors?: boolean } = {},
  ): Promise<AvailableSlot[]> {
    const windowRepo =
      manager?.getRepository(AvailabilityWindow) ?? this.windowRepo;
    const bookingRepo = manager?.getRepository(Booking) ?? this.bookingRepo;

    const { start: dayStart, end: dayEnd } = utcDayBounds(date);

    // keep the original window boundaries so slot generation stays anchored
    // to the advisor's actual availability start.
    const windows = await findWindowsOnDate(windowRepo, date);
    if (windows.length === 0) return [];

    // include nearby bookings whose buffers may affect these windows.
    // expired holds are filtered by the slot calculator.
    const earliestStart = Math.min(...windows.map((w) => w.startAt.getTime()));
    const latestEnd = Math.max(...windows.map((w) => w.endAt.getTime()));
    const advisorIds = [...new Set(windows.map((w) => w.advisorId))];

    // Lock before reading bookings so concurrent allocations see the latest holds.
    if (lockAdvisors) {
      if (!manager) {
        throw new Error('lockAdvisors requires a transaction manager');
      }
      await acquireAdvisorLocks(manager, advisorIds);
    }

    const bookings = await bookingRepo.find({
      where: {
        advisorId: In(advisorIds),
        status: In([BookingStatus.HELD, BookingStatus.CONFIRMED]),
        endAt: MoreThan(new Date(earliestStart - MAX_BUFFER_MS)),
        startAt: LessThan(new Date(latestEnd + MAX_BUFFER_MS)),
      },
    });

    const slots = advisorIds.flatMap((advisorId) =>
      calculateSlots(
        windows.filter((w) => w.advisorId === advisorId),
        bookings.filter((b) => b.advisorId === advisorId),
        visaType,
        now,
      ).map((slot) => ({ advisorId, ...slot })),
    );

    // return slots starting on the requested day, ordered by earliest start
    // with advisor ID as a deterministic tie-breaker.
    return slots
      .filter(
        (slot) =>
          slot.startAt.getTime() >= dayStart.getTime() &&
          slot.startAt.getTime() < dayEnd.getTime(),
      )
      .sort(
        (a, b) =>
          a.startAt.getTime() - b.startAt.getTime() ||
          a.advisorId.localeCompare(b.advisorId),
      );
  }

  // anything that releases and then reallocates capacity takes the whole
  // day's set up front. Locking one advisor and then the rest can deadlock
  // against a booking request locking them in id order.
  async lockAdvisorsForDate(
    manager: EntityManager,
    date: string,
  ): Promise<void> {
    const windows = await findWindowsOnDate(
      manager.getRepository(AvailabilityWindow),
      date,
    );
    await acquireAdvisorLocks(manager, [
      ...new Set(windows.map((w) => w.advisorId)),
    ]);
  }
}

function findWindowsOnDate(
  windowRepo: Repository<AvailabilityWindow>,
  date: string,
): Promise<AvailabilityWindow[]> {
  const { start, end } = utcDayBounds(date);
  return windowRepo.find({
    where: { startAt: LessThan(end), endAt: MoreThan(start) },
  });
}
