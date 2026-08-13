import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../common/prisma.service';
import type { QueueService } from '../common/queue.service';
import type { SubscriptionPolicyService } from '../common/subscription-policy.service';
import type { WorkspacesService } from '../workspaces/workspaces.service';
import { ImportEngineService, type ImportMapping } from './import-engine.service';

type EngineInternals = {
  autoMapping(columns: string[]): ImportMapping;
  normalizeRow(raw: Record<string, unknown>, mapping: ImportMapping, importId: string): Record<string, unknown>;
};

describe('ImportEngineService', () => {
  const service = new ImportEngineService({} as PrismaService, {} as WorkspacesService, {} as SubscriptionPolicyService, {} as QueueService) as unknown as EngineInternals;

  it('detects Vietnamese and common CRM column aliases', () => {
    expect(service.autoMapping(['Họ tên', 'Số điện thoại', 'Zalo ID', 'Nguồn', 'Đồng ý'])).toEqual({
      'Họ tên': 'displayName',
      'Số điện thoại': 'phone',
      'Zalo ID': 'platformUserId',
      'Nguồn': 'source',
      'Đồng ý': 'consentStatus',
    });
  });

  it('normalizes Vietnamese phone numbers and opt-in consent', () => {
    const value = service.normalizeRow(
      { name: 'Khách hàng A', phone: '0964 566 658', consent: 'đồng ý' },
      { name: 'displayName', phone: 'phone', consent: 'consentStatus' },
      'import-1',
    );
    expect(value).toMatchObject({ displayName: 'Khách hàng A', normalizedPhone: '+84964566658', consentStatus: 'OPTED_IN', source: 'IMPORT:import-1' });
  });

  it('rejects a row without phone or Zalo user id', () => {
    expect(() => service.normalizeRow({ name: 'Thiếu định danh' }, { name: 'displayName' }, 'import-2')).toThrow(/điện thoại|Zalo ID/i);
  });
});
