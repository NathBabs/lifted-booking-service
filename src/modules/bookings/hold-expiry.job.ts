import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThanOrEqual, Repository } from 'typeorm';
import { toUtcDate } from '../../common/utils/utc-day';
import { Booking, BookingStatus } from '../../database';
import { AvailabilityService } from '../availability/availability.service';
import { WaitlistService } from '../waitlist/waitlist.service';

const SWEEP_INTERVAL_MS = 5_000;

// Availability already ignores lapsed holds. This makes the release actually
// happen when nobody else is calling the API: statuses get updated and the
// freed capacity goes to the waitlist.
@Injectable()
export class HoldExpiryJob {
  private readonly logger = new Logger(HoldExpiryJob.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly availabilityService: AvailabilityService,
    private readonly waitlistService: WaitlistService,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async processLapsedHolds(now = new Date()): Promise<void> {
    const lapsed = await this.bookingRepo.find({
      select: { id: true, startAt: true },
      where: { status: BookingStatus.HELD, expiresAt: LessThanOrEqual(now) },
    });
    const dates = [...new Set(lapsed.map((b) => toUtcDate(b.startAt)))];

    // One transaction per day, so one bad day doesn't block the rest.
    for (const date of dates) {
      try {
        const { expiredHolds, offers } = await this.dataSource.transaction(
          async (manager) => {
            await this.availabilityService.lockAdvisorsForDate(manager, date);
            return this.waitlistService.reconcileDate(manager, date, now);
          },
        );
        this.logger.log(
          `${date}: expired ${expiredHolds} hold(s), made ${offers.length} waitlist offer(s)`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to reconcile ${date}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }
}
