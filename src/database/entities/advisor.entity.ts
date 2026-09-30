import { Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { BaseEntity } from '../abstracts/base.entity';
import { AvailabilityWindow } from './availability-window.entity';
import { Booking } from './booking.entity';

@Entity('advisors')
export class Advisor extends BaseEntity {
  @PrimaryColumn({ length: 25 })
  id!: string;

  @Column({ length: 100 })
  name!: string;

  @OneToMany(() => AvailabilityWindow, (avWindow) => avWindow.advisor)
  availabilityWindows!: AvailabilityWindow[];

  @OneToMany(() => Booking, (booking) => booking.advisor)
  bookings!: Booking[];
}
