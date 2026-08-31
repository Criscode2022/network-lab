import { Module } from '@nestjs/common';
import {
  AuthController,
  AuthService,
  CommandsController,
  EveToolsController,
  HealthController,
  LabsController,
  SessionsController,
} from './http.ts';
import { SimService } from './sim.service.ts';

@Module({
  controllers: [HealthController, AuthController, LabsController, SessionsController, EveToolsController, CommandsController],
  providers: [AuthService, SimService],
})
export class AppModule {}
