import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformsController } from './platforms.controller';
import { PlatformRegistryService } from './platform-registry.service';

@Module({
  imports: [AuthModule],
  controllers: [PlatformsController],
  providers: [PlatformRegistryService],
  exports: [PlatformRegistryService],
})
export class PlatformsModule {}
