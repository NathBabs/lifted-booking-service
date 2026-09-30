import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, MoreThan } from 'typeorm';
import {
  Booking,
  BookingStatus,
  ConfirmationRequiredBy,
  VisaType,
} from '../../database';
import { AvailabilityService } from '../availability/availability.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { BookingsService } from './bookings.service';

describe('BookingsService.requestBooking', () => {
  const NOW = new Date('2026-09-30T12:00:00Z');
  const request = {
    candidateName: 'Ada Obi',
    visaType: VisaType.A,
    date: '2025-03-10',
  };

  // A fake transaction: runs the callback straight away with a fake manager.
  const manager = {
    create: jest.fn((_entity: unknown, data: object) => data),
    save: jest.fn((entity: object) =>
      Promise.resolve({ id: 'booking-1', ...entity }),
    ),
  };
  const dataSource = {
    transaction: jest.fn((work: (m: typeof manager) => Promise<unknown>) =>
      work(manager),
    ),
  };
  const availabilityService = {
    getAvailableSlots: jest.fn(),
    lockAdvisorsForDate: jest.fn(),
  };
  const waitlistService = { join: jest.fn(), reconcileDate: jest.fn() };

  let service: BookingsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: DataSource, useValue: dataSource },
        { provide: AvailabilityService, useValue: availabilityService },
        { provide: WaitlistService, useValue: waitlistService },
        { provide: getRepositoryToken(Booking), useValue: {} },
      ],
    }).compile();

    service = module.get(BookingsService);
  });

  it('locks the day and settles its waitlist before serving a newcomer', async () => {
    availabilityService.getAvailableSlots.mockResolvedValue([]);
    waitlistService.join.mockResolvedValue({ id: 'entry-1' });

    await service.requestBooking(request, NOW);

    expect(availabilityService.lockAdvisorsForDate).toHaveBeenCalledWith(
      manager,
      '2025-03-10',
    );
    expect(waitlistService.reconcileDate).toHaveBeenCalledWith(
      manager,
      '2025-03-10',
      NOW,
    );
    const order = (fn: jest.Mock) => fn.mock.invocationCallOrder[0];
    expect(order(availabilityService.lockAdvisorsForDate)).toBeLessThan(
      order(waitlistService.reconcileDate),
    );
    expect(order(waitlistService.reconcileDate)).toBeLessThan(
      order(availabilityService.getAvailableSlots),
    );
  });

  it('recalculates availability inside the transaction, with the advisors locked', async () => {
    availabilityService.getAvailableSlots.mockResolvedValue([
      {
        advisorId: 'ia-001',
        startAt: new Date('2025-03-10T09:00:00Z'),
        endAt: new Date('2025-03-10T09:30:00Z'),
      },
    ]);

    await service.requestBooking(request, NOW);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(availabilityService.getAvailableSlots).toHaveBeenCalledWith(
      VisaType.A,
      '2025-03-10',
      { now: NOW, manager, lockAdvisors: true },
    );
  });

  it('holds the earliest slot for 10 minutes, awaiting advisor confirmation', async () => {
    availabilityService.getAvailableSlots.mockResolvedValue([
      {
        advisorId: 'ia-001',
        startAt: new Date('2025-03-10T09:00:00Z'),
        endAt: new Date('2025-03-10T09:30:00Z'),
      },
      {
        advisorId: 'ia-002',
        startAt: new Date('2025-03-10T09:00:00Z'),
        endAt: new Date('2025-03-10T09:30:00Z'),
      },
    ]);

    const result = await service.requestBooking(request, NOW);

    expect(manager.create).toHaveBeenCalledWith(Booking, {
      advisorId: 'ia-001',
      candidateName: 'Ada Obi',
      visaType: VisaType.A,
      startAt: new Date('2025-03-10T09:00:00Z'),
      endAt: new Date('2025-03-10T09:30:00Z'),
      status: BookingStatus.HELD,
      expiresAt: new Date('2026-09-30T12:10:00Z'),
      confirmationRequiredBy: ConfirmationRequiredBy.ADVISOR,
    });
    expect(result).toMatchObject({
      outcome: 'HELD',
      booking: { id: 'booking-1' },
    });
    expect(waitlistService.join).not.toHaveBeenCalled();
  });

  it('joins the waitlist in the same transaction when no slot is free', async () => {
    availabilityService.getAvailableSlots.mockResolvedValue([]);
    waitlistService.join.mockResolvedValue({ id: 'entry-1' });

    const result = await service.requestBooking(request, NOW);

    expect(waitlistService.join).toHaveBeenCalledWith(manager, {
      candidateName: 'Ada Obi',
      visaType: VisaType.A,
      requestedDate: '2025-03-10',
    });
    expect(result).toEqual({
      outcome: 'WAITLISTED',
      waitlistEntry: { id: 'entry-1' },
    });
    expect(manager.save).not.toHaveBeenCalled();
  });
});

describe('BookingsService confirm, cancel and findAll', () => {
  const ID = 'b0a1c2d3-0000-4000-8000-000000000001';
  const PAST = new Date('2025-01-01T00:00:00Z');
  const FUTURE = new Date('2999-01-01T00:00:00Z');
  const anyDate = expect.any(Date) as Date;

  let lockQuery: Record<string, jest.Mock>;
  let txRepo: Record<string, jest.Mock>;
  let bookingRepo: Record<string, jest.Mock>;
  let availabilityService: Record<string, jest.Mock>;
  let waitlistService: Record<string, jest.Mock>;
  let manager: { getRepository: (entity: unknown) => unknown };
  let service: BookingsService;

  beforeEach(async () => {
    availabilityService = { lockAdvisorsForDate: jest.fn() };
    waitlistService = { withdrawOffer: jest.fn(), reconcileDate: jest.fn() };
    lockQuery = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    txRepo = {
      findOneBy: jest.fn(),
      findOneByOrFail: jest.fn(),
      update: jest.fn(),
    };
    bookingRepo = { find: jest.fn(), findOneBy: jest.fn(), update: jest.fn() };

    // Booking repo for booking queries, anything else is the advisor lock.
    manager = {
      getRepository: (entity: unknown) =>
        entity === Booking ? txRepo : { createQueryBuilder: () => lockQuery },
    };

    const module = await Test.createTestingModule({
      providers: [
        BookingsService,
        {
          provide: DataSource,
          useValue: {
            transaction: (work: (m: typeof manager) => Promise<unknown>) =>
              work(manager),
          },
        },
        { provide: AvailabilityService, useValue: availabilityService },
        { provide: WaitlistService, useValue: waitlistService },
        { provide: getRepositoryToken(Booking), useValue: bookingRepo },
      ],
    }).compile();

    service = module.get(BookingsService);
  });

  describe('confirm', () => {
    it('takes the advisor lock, then confirms only a live advisor hold', async () => {
      txRepo.findOneBy.mockResolvedValue({ id: ID, advisorId: 'ia-001' });
      txRepo.update.mockResolvedValue({ affected: 1 });
      txRepo.findOneByOrFail.mockResolvedValue({
        id: ID,
        status: BookingStatus.CONFIRMED,
      });

      const booking = await service.confirm(ID);

      expect(lockQuery.where).toHaveBeenCalledWith(
        'advisor.id IN (:...advisorIds)',
        { advisorIds: ['ia-001'] },
      );
      expect(txRepo.update).toHaveBeenCalledWith(
        {
          id: ID,
          status: BookingStatus.HELD,
          confirmationRequiredBy: ConfirmationRequiredBy.ADVISOR,
          expiresAt: MoreThan(anyDate),
        },
        { status: BookingStatus.CONFIRMED, confirmedAt: anyDate },
      );
      expect(lockQuery.getMany.mock.invocationCallOrder[0]).toBeLessThan(
        txRepo.update.mock.invocationCallOrder[0],
      );
      expect(booking.status).toBe(BookingStatus.CONFIRMED);
    });

    it('404s for an unknown booking', async () => {
      txRepo.findOneBy.mockResolvedValue(null);

      await expect(service.confirm(ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(txRepo.update).not.toHaveBeenCalled();
    });

    it('409s when the hold has lapsed, even if the row still says HELD', async () => {
      txRepo.findOneBy.mockResolvedValue({ id: ID, advisorId: 'ia-001' });
      txRepo.update.mockResolvedValue({ affected: 0 });
      txRepo.findOneByOrFail.mockResolvedValue({
        status: BookingStatus.HELD,
        expiresAt: PAST,
      });

      await expect(service.confirm(ID)).rejects.toThrow('The hold has expired');
    });

    it('409s when the booking is already confirmed', async () => {
      txRepo.findOneBy.mockResolvedValue({ id: ID, advisorId: 'ia-001' });
      txRepo.update.mockResolvedValue({ affected: 0 });
      txRepo.findOneByOrFail.mockResolvedValue({
        status: BookingStatus.CONFIRMED,
        expiresAt: PAST,
      });

      await expect(service.confirm(ID)).rejects.toThrow(
        'Booking is already CONFIRMED',
      );
    });
  });

  describe('cancel', () => {
    const startAt = new Date('2025-03-10T09:00:00Z');

    it('locks the day, cancels, withdraws any offer, then reconciles the day', async () => {
      txRepo.findOneBy.mockResolvedValue({ id: ID, startAt });
      txRepo.update.mockResolvedValue({ affected: 1 });
      txRepo.findOneByOrFail.mockResolvedValue({
        id: ID,
        status: BookingStatus.CANCELLED,
      });

      await service.cancel(ID);

      expect(availabilityService.lockAdvisorsForDate).toHaveBeenCalledWith(
        manager,
        '2025-03-10',
      );
      expect(txRepo.update).toHaveBeenCalledWith(
        [
          { id: ID, status: BookingStatus.CONFIRMED },
          {
            id: ID,
            status: BookingStatus.HELD,
            expiresAt: MoreThan(anyDate),
          },
        ],
        { status: BookingStatus.CANCELLED, cancelledAt: anyDate },
      );
      expect(waitlistService.withdrawOffer).toHaveBeenCalledWith(manager, ID);
      expect(waitlistService.reconcileDate).toHaveBeenCalledWith(
        manager,
        '2025-03-10',
        anyDate,
      );
      expect(
        availabilityService.lockAdvisorsForDate.mock.invocationCallOrder[0],
      ).toBeLessThan(txRepo.update.mock.invocationCallOrder[0]);
    });

    it('409s for a hold that has already lapsed, and reallocates nothing', async () => {
      txRepo.findOneBy.mockResolvedValue({ id: ID, startAt });
      txRepo.update.mockResolvedValue({ affected: 0 });
      txRepo.findOneByOrFail.mockResolvedValue({
        status: BookingStatus.HELD,
        expiresAt: PAST,
      });

      await expect(service.cancel(ID)).rejects.toThrow(
        'Booking is already EXPIRED',
      );
      expect(waitlistService.reconcileDate).not.toHaveBeenCalled();
    });

    it('404s for an unknown booking', async () => {
      txRepo.findOneBy.mockResolvedValue(null);

      await expect(service.cancel(ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(txRepo.update).not.toHaveBeenCalled();
    });
  });

  it('findAll reports lapsed holds as EXPIRED before the job catches up', async () => {
    bookingRepo.find.mockResolvedValue([
      { id: 'lapsed', status: BookingStatus.HELD, expiresAt: PAST },
      { id: 'live', status: BookingStatus.HELD, expiresAt: FUTURE },
      { id: 'done', status: BookingStatus.CONFIRMED, expiresAt: PAST },
    ]);

    const bookings = await service.findAll();

    expect(bookings.map((b) => [b.id, b.status])).toEqual([
      ['lapsed', BookingStatus.EXPIRED],
      ['live', BookingStatus.HELD],
      ['done', BookingStatus.CONFIRMED],
    ]);
  });
});
