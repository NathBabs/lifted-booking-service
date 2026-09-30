import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Advisor } from '../entities/advisor.entity';
import { AvailabilityWindow } from '../entities/availability-window.entity';
import { SeederService } from './seeder.service';

@Module({
  imports: [TypeOrmModule.forFeature([Advisor, AvailabilityWindow])],
  providers: [SeederService],
  exports: [SeederService],
})
export class SeederModule {}
