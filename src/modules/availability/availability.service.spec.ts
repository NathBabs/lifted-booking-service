import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, In, LessThan, MoreThan } from 'typeorm';
import {
  AvailabilityWindow,
  Booking,
  BookingStatus,
  VisaType,
} from '../../database';
import { AvailabilityService } from './availability.service';

const windowFor = (advisorId: string, start: string, end: string) =>
  ({
    advisorId,
    startAt: new Date(start),
    endAt: new Date(end),
  }) as AvailabilityWindow;

describe('AvailabilityService', () => {
  let service: AvailabilityService;
  const windowRepo = { find: jest.fn() };
  const bookingRepo = { find: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    bookingRepo.find.mockResolvedValue([]);

    const module = await Test.createTestingModule({
      providers: [
        AvailabilityService,
        {
          provide: getRepositoryToken(AvailabilityWindow),
          useValue: windowRepo,
        },
        { provide: getRepositoryToken(Booking), useValue: bookingRepo },
      ],
    }).compile();

    service = module.get(AvailabilityService);
  });

  it('returns nothing, without querying bookings, when no window overlaps the day', async () => {
    windowRepo.find.mockResolvedValue([]);

    await expect(
      service.getAvailableSlots(VisaType.A, '2025-03-10'),
    ).resolves.toEqual([]);
    expect(bookingRepo.find).not.toHaveBeenCalled();
  });

  it('loads active bookings padded by the longest break (10m) on both sides of the windows', async () => {
    windowRepo.find.mockResolvedValue([
      windowFor('ia-001', '2025-03-10T09:00:00Z', '2025-03-10T10:00:00Z'),
    ]);

    await service.getAvailableSlots(VisaType.A, '2025-03-10');

    expect(bookingRepo.find).toHaveBeenCalledWith({
      where: {
        advisorId: In(['ia-001']),
        status: In([BookingStatus.HELD, BookingStatus.CONFIRMED]),
        endAt: MoreThan(new Date('2025-03-10T08:50:00Z')),
        startAt: LessThan(new Date('2025-03-10T10:10:00Z')),
      },
    });
  });

  it('merges all advisors, ordered by start time with advisorId as the tie-breaker', async () => {
    windowRepo.find.mockResolvedValue([
      windowFor('ia-002', '2025-03-10T09:00:00Z', '2025-03-10T10:00:00Z'),
      windowFor('ia-001', '2025-03-10T09:00:00Z', '2025-03-10T10:00:00Z'),
    ]);

    const slots = await service.getAvailableSlots(VisaType.A, '2025-03-10');

    expect(
      slots.map(
        (s) => `${s.advisorId} ${s.startAt.toISOString().slice(11, 16)}`,
      ),
    ).toEqual(['ia-001 09:00', 'ia-002 09:00', 'ia-001 09:30', 'ia-002 09:30']);
  });

  it("anchors the slot grid to the window's real start, not midnight, and keeps only slots starting on the day", async () => {
    // Slots run 23:10, 23:40, 00:10 (00:40-01:10 overruns the window).
    // Clipping the window at midnight would wrongly give 00:00 and 00:30.
    windowRepo.find.mockResolvedValue([
      windowFor('ia-001', '2025-03-09T23:10:00Z', '2025-03-10T01:00:00Z'),
    ]);

    const slots = await service.getAvailableSlots(VisaType.A, '2025-03-10');

    expect(slots.map((s) => s.startAt.toISOString())).toEqual([
      '2025-03-10T00:10:00.000Z',
    ]);
  });

  it('with lockAdvisors, locks the advisors in id order BEFORE reading bookings', async () => {
    const lockQuery = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const advisorRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(lockQuery),
    };
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === AvailabilityWindow
          ? windowRepo
          : entity === Booking
            ? bookingRepo
            : advisorRepo,
      ),
    } as unknown as EntityManager;

    windowRepo.find.mockResolvedValue([
      windowFor('ia-002', '2025-03-10T09:00:00Z', '2025-03-10T10:00:00Z'),
      windowFor('ia-001', '2025-03-10T09:00:00Z', '2025-03-10T10:00:00Z'),
    ]);

    await service.getAvailableSlots(VisaType.A, '2025-03-10', {
      manager,
      lockAdvisors: true,
    });

    expect(lockQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(lockQuery.where).toHaveBeenCalledWith(
      'advisor.id IN (:...advisorIds)',
      { advisorIds: ['ia-002', 'ia-001'] },
    );
    expect(lockQuery.orderBy).toHaveBeenCalledWith('advisor.id');
    // The lock must be taken before bookings are read, or a concurrent hold
    // committed in between would be missed.
    expect(lockQuery.getMany.mock.invocationCallOrder[0]).toBeLessThan(
      bookingRepo.find.mock.invocationCallOrder[0],
    );
  });
});
