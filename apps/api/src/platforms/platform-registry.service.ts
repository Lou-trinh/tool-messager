import { Injectable } from '@nestjs/common';
import { FacebookAdapter } from '@omni/platform-facebook';
import type { PlatformAdapter } from '@omni/platform-core';
import { TikTokAdapter } from '@omni/platform-tiktok';
import { ZaloAdapter } from '@omni/platform-zalo';
import type { Platform } from '@omni/shared';

@Injectable()
export class PlatformRegistryService {
  private readonly zaloAdapter = new ZaloAdapter();
  private readonly adapters = new Map<Platform, PlatformAdapter>([
    ['ZALO', this.zaloAdapter],
    ['FACEBOOK', new FacebookAdapter()],
    ['TIKTOK', new TikTokAdapter()],
  ]);

  get(platform: Platform): PlatformAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) throw new Error(`No adapter registered for ${platform}.`);
    return adapter;
  }

  zalo(): ZaloAdapter {
    return this.zaloAdapter;
  }

  matrix(): unknown[] {
    return [...this.adapters.values()].map((adapter) => ({
      platform: adapter.platform,
      capabilities: adapter.capabilities(),
      configured: adapter.isConfigured(),
    }));
  }
}
