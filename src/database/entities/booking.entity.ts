import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseEntity } from '../abstracts/base.entity';
import { Advisor } from './advisor.entity';

export enum VisaType {
  A = 'A',
  B = 'B',
}

export enum BookingStatus {
  HELD = 'HELD',
  CONFIRMED = 'CONFIRMED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum ConfirmationRequiredBy {
  ADVISOR = 'ADVISOR',
  CANDIDATE = 'CANDIDATE',
}

@Index(['advisorId', 'startAt'])
@Index(['status', 'expiresAt'])
@Entity('bookings')
export class Booking extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @JoinColumn({ name: 'advisor_id' })
  @ManyToOne(() => Advisor, (advisor) => advisor.bookings, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  advisor!: Advisor;

  @Column({ name: 'advisor_id', length: 25 })
  advisorId!: string;

  @Column({ length: 100 })
  candidateName!: string;

  @Column({ type: 'enum', enum: VisaType, enumName: 'visa_type' })
  visaType!: VisaType;

  @Column({ type: 'timestamptz' })
  startAt!: Date;

  @Column({ type: 'timestamptz' })
  endAt!: Date;

  @Column({
    type: 'enum',
    enum: BookingStatus,
    enumName: 'booking_status',
    default: BookingStatus.HELD,
  })
  status!: BookingStatus;

  // When the 10-minute hold runs out. It stays set after the booking is confirmed.
  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  @Column({
    type: 'enum',
    enum: ConfirmationRequiredBy,
    enumName: 'confirmation_required_by',
    default: ConfirmationRequiredBy.ADVISOR,
  })
  confirmationRequiredBy!: ConfirmationRequiredBy;

  @Column({ type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;
}
