import { ConflictException } from '@nestjs/common';
import {
  And,
  DataSource,
  In,
  LessThan,
  LessThanOrEqual,
  MoreThan,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import {
  Booking,
  BookingStatus,
  ConfirmationRequiredBy,
  VisaType,
  WaitlistEntry,
  WaitlistStatus,
} from '../../database';
import { AvailabilityService } from '../availability/availability.service';
import { WaitlistService } from './waitlist.service';

const DATE = '2025-03-10';
const NOW = new Date('2026-09-30T12:00:00Z');
const anyDate = expect.any(Date) as Date;

const entry = (id: string, visaType: VisaType, extra = {}) => ({
  id,
  candidateName: id,
  visaType,
  requestedDate: DATE,
  status: WaitlistStatus.WAITING,
  ...extra,
});

const slot = (hhmm: string) => ({
  advisorId: 'ia-001',
  startAt: new Date(`${DATE}T${hhmm}:00Z`),
  endAt: new Date(`${DATE}T${hhmm}:30Z`),
});

describe('WaitlistService', () => {
  let manager: Record<string, jest.Mock>;
  let lockQuery: Record<string, jest.Mock>;
  let availability: Record<string, jest.Mock>;
  let service: WaitlistService;

  beforeEach(() => {
    lockQuery = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    let bookingCount = 0;
    manager = {
      // The expire step asks for RETURNING; everything else is a plain update.
      update: jest.fn((_entity, _where, _set, options?: object) =>
        Promise.resolve(options ? { raw: [] } : { affected: 1 }),
      ),
      find: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn(),
      findOneByOrFail: jest.fn(),
      create: jest.fn((_entity: unknown, data: object) => data),
      save: jest.fn((data: object) =>
        Promise.resolve({ id: `booking-${++bookingCount}`, ...data }),
      ),
      getRepository: jest.fn(() => ({ createQueryBuilder: () => lockQuery })),
    };
    availability = {
      getAvailableSlots: jest.fn().mockResolvedValue([]),
      lockAdvisorsForDate: jest.fn(),
    };

    service = new WaitlistService(
      {
        transaction: (work: (m: object) => Promise<unknown>) => work(manager),
      } as unknown as DataSource,
      availability as unknown as AvailabilityService,
      {} as Repository<WaitlistEntry>,
    );
  });

  describe('reconcileDate', () => {
    it("expires the day's lapsed holds and moves their candidates out of the queue", async () => {
      manager.update.mockResolvedValueOnce({ raw: [{ id: 'held-1' }] });

      const result = await service.reconcileDate(manager as never, DATE, NOW);

      expect(manager.update).toHaveBeenNthCalledWith(
        1,
        Booking,
        {
          status: BookingStatus.HELD,
          expiresAt: LessThanOrEqual(NOW),
          startAt: And(
            MoreThanOrEqual(new Date(`${DATE}T00:00:00Z`)),
            LessThan(new Date('2025-03-11T00:00:00Z')),
          ),
        },
        { status: BookingStatus.EXPIRED },
        { returning: ['id'] },
      );
      expect(manager.update).toHaveBeenNthCalledWith(
        2,
        WaitlistEntry,
        { offeredBookingId: In(['held-1']), status: WaitlistStatus.OFFERED },
        { status: WaitlistStatus.EXPIRED },
      );
      expect(result).toEqual({ expiredHolds: 1, offers: [] });
    });

    it("offers the oldest entry that fits; one that doesn't keeps its place", async () => {
      const alice = entry('alice', VisaType.B);
      const bob = entry('bob', VisaType.A);
      manager.find
        .mockResolvedValueOnce([alice, bob])
        .mockResolvedValueOnce([alice]);
      availability.getAvailableSlots.mockImplementation((visaType) =>
        Promise.resolve(visaType === VisaType.A ? [slot('09:00')] : []),
      );

      const { offers } = await service.reconcileDate(
        manager as never,
        DATE,
        NOW,
      );

      expect(offers.map((o) => [o.id, o.status])).toEqual([
        ['bob', WaitlistStatus.OFFERED],
      ]);
      expect(manager.create).toHaveBeenCalledTimes(1);
      expect(manager.create).toHaveBeenCalledWith(
        Booking,
        expect.objectContaining({
          candidateName: 'bob',
          advisorId: 'ia-001',
          status: BookingStatus.HELD,
          confirmationRequiredBy: ConfirmationRequiredBy.CANDIDATE,
        }),
      );
      expect(manager.update).toHaveBeenCalledWith(
        WaitlistEntry,
        { id: 'bob', status: WaitlistStatus.WAITING },
        {
          status: WaitlistStatus.OFFERED,
          offeredBookingId: 'booking-1',
          offeredAt: NOW,
        },
      );
    });

    it('keeps offering, recalculating each time, until nobody fits', async () => {
      const bob = entry('bob', VisaType.A);
      const cara = entry('cara', VisaType.A);
      manager.find
        .mockResolvedValueOnce([bob, cara])
        .mockResolvedValueOnce([cara])
        .mockResolvedValueOnce([]);
      availability.getAvailableSlots
        .mockResolvedValueOnce([slot('09:00')])
        .mockResolvedValueOnce([slot('10:00')]);

      const { offers } = await service.reconcileDate(
        manager as never,
        DATE,
        NOW,
      );

      expect(offers.map((o) => o.id)).toEqual(['bob', 'cara']);
      expect(availability.getAvailableSlots).toHaveBeenCalledWith(
        VisaType.A,
        DATE,
        { now: NOW, manager, lockAdvisors: true },
      );
    });
  });

  describe('accept', () => {
    beforeEach(() => {
      manager.findOneBy.mockResolvedValue(
        entry('e1', VisaType.A, {
          status: WaitlistStatus.OFFERED,
          offeredBookingId: 'b1',
        }),
      );
      manager.findOneByOrFail.mockImplementation((entity) =>
        Promise.resolve(
          entity === Booking
            ? { id: 'b1', advisorId: 'ia-001' }
            : { id: 'e1', status: WaitlistStatus.OFFERED },
        ),
      );
    });

    it('confirms the live candidate hold under the advisor lock and fulfils the entry', async () => {
      await service.accept('e1');

      expect(manager.update).toHaveBeenCalledWith(
        Booking,
        {
          id: 'b1',
          status: BookingStatus.HELD,
          confirmationRequiredBy: ConfirmationRequiredBy.CANDIDATE,
          expiresAt: MoreThan(anyDate),
        },
        { status: BookingStatus.CONFIRMED, confirmedAt: anyDate },
      );
      expect(manager.update).toHaveBeenCalledWith(
        WaitlistEntry,
        { id: 'e1', status: WaitlistStatus.OFFERED },
        { status: WaitlistStatus.FULFILLED },
      );
      expect(lockQuery.getMany.mock.invocationCallOrder[0]).toBeLessThan(
        manager.update.mock.invocationCallOrder[0],
      );
    });

    it('409s when the offer has lapsed', async () => {
      manager.update.mockResolvedValueOnce({ affected: 0 });

      await expect(service.accept('e1')).rejects.toThrow(
        'The offer has expired or was withdrawn',
      );
    });
  });

  describe('cancel', () => {
    beforeEach(() => {
      manager.findOneBy.mockResolvedValue(entry('e1', VisaType.A));
    });

    it('lets a waiting candidate leave the queue without reallocating', async () => {
      manager.findOneByOrFail.mockResolvedValue(entry('e1', VisaType.A));
      const reconcile = jest.spyOn(service, 'reconcileDate');

      await service.cancel('e1');

      expect(availability.lockAdvisorsForDate).toHaveBeenCalledWith(
        manager,
        DATE,
      );
      expect(manager.update).toHaveBeenCalledWith(
        WaitlistEntry,
        { id: 'e1' },
        { status: WaitlistStatus.CANCELLED },
      );
      expect(manager.update).not.toHaveBeenCalledWith(
        Booking,
        expect.anything(),
        expect.anything(),
      );
      expect(reconcile).not.toHaveBeenCalled();
    });

    it('declining an offer releases the held slot and reconciles the day', async () => {
      manager.findOneByOrFail.mockResolvedValue(
        entry('e1', VisaType.A, {
          status: WaitlistStatus.OFFERED,
          offeredBookingId: 'b1',
        }),
      );
      const reconcile = jest
        .spyOn(service, 'reconcileDate')
        .mockResolvedValue({ expiredHolds: 0, offers: [] });

      await service.cancel('e1');

      expect(manager.update).toHaveBeenCalledWith(
        Booking,
        { id: 'b1', status: BookingStatus.HELD },
        { status: BookingStatus.CANCELLED, cancelledAt: anyDate },
      );
      expect(reconcile).toHaveBeenCalledWith(manager, DATE, anyDate);
    });

    it('409s for an entry that is already finished', async () => {
      manager.findOneByOrFail.mockResolvedValue(
        entry('e1', VisaType.A, { status: WaitlistStatus.FULFILLED }),
      );

      await expect(service.cancel('e1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
