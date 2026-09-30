import { Logger } from '@nestjs/common';
import { DataSource, LessThanOrEqual, Repository } from 'typeorm';
import { Booking, BookingStatus } from '../../database';
import { AvailabilityService } from '../availability/availability.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { HoldExpiryJob } from './hold-expiry.job';

describe('HoldExpiryJob', () => {
  const now = new Date('2026-09-30T12:00:00Z');
  const manager = {};

  let bookingRepo: { find: jest.Mock };
  let lockAdvisorsForDate: jest.Mock;
  let reconcileDate: jest.Mock;
  let logError: jest.SpyInstance;
  let job: HoldExpiryJob;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    bookingRepo = { find: jest.fn() };
    lockAdvisorsForDate = jest.fn();
    reconcileDate = jest
      .fn()
      .mockResolvedValue({ expiredHolds: 1, offers: [] });

    job = new HoldExpiryJob(
      {
        transaction: (work: (m: object) => Promise<unknown>) => work(manager),
      } as unknown as DataSource,
      { lockAdvisorsForDate } as unknown as AvailabilityService,
      { reconcileDate } as unknown as WaitlistService,
      bookingRepo as unknown as Repository<Booking>,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it("reconciles each day with lapsed holds once, under that day's locks", async () => {
    bookingRepo.find.mockResolvedValue([
      { id: 'a', startAt: new Date('2025-03-10T09:00:00Z') },
      { id: 'b', startAt: new Date('2025-03-10T10:00:00Z') },
      { id: 'c', startAt: new Date('2025-03-11T09:00:00Z') },
    ]);

    await job.processLapsedHolds(now);

    expect(bookingRepo.find).toHaveBeenCalledWith({
      select: { id: true, startAt: true },
      where: { status: BookingStatus.HELD, expiresAt: LessThanOrEqual(now) },
    });
    expect(lockAdvisorsForDate.mock.calls).toEqual([
      [manager, '2025-03-10'],
      [manager, '2025-03-11'],
    ]);
    expect(reconcileDate.mock.calls).toEqual([
      [manager, '2025-03-10', now],
      [manager, '2025-03-11', now],
    ]);
  });

  it('carries on with the other days when one fails', async () => {
    bookingRepo.find.mockResolvedValue([
      { id: 'a', startAt: new Date('2025-03-10T09:00:00Z') },
      { id: 'c', startAt: new Date('2025-03-11T09:00:00Z') },
    ]);
    reconcileDate.mockRejectedValueOnce(new Error('boom'));

    await job.processLapsedHolds(now);

    expect(reconcileDate).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledTimes(1);
  });
});
