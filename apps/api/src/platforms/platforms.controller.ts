import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformRegistryService } from './platform-registry.service';

@UseGuards(JwtAuthGuard)
@Controller('platforms')
export class PlatformsController {
  constructor(private readonly registry: PlatformRegistryService) {}

  @Get('capabilities')
  capabilities(): unknown { return { success: true, data: this.registry.matrix() }; }
}
