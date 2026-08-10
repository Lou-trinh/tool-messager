import type { CapabilityStatus, Platform } from '@omni/shared';

export type PlatformCapability =
  | 'AUTHENTICATE'
  | 'CONTACTS'
  | 'FRIENDS'
  | 'GROUPS'
  | 'GROUP_MEMBERS'
  | 'MESSAGING'
  | 'MEDIA'
  | 'POST_CREATE'
  | 'POST_UPDATE'
  | 'POST_DELETE'
  | 'MESSAGE_HISTORY'
  | 'GROUP_CREATE'
  | 'GROUP_MEMBER_MANAGE'
  | 'ANALYTICS';

export type CapabilityMatrix = Readonly<Record<PlatformCapability, CapabilityStatus>>;

export interface AdapterContext {
  workspaceId: string;
  accountId: string;
  accessToken?: string;
}

export interface PlatformOperationResult<T> {
  status: 'SUCCESS' | 'NOT_CONFIGURED' | 'NOT_SUPPORTED' | 'FAILED';
  data?: T;
  errorCode?: string;
  message?: string;
}

export interface PlatformAdapter {
  readonly platform: Platform;
  capabilities(): CapabilityMatrix;
  isConfigured(): boolean;
  authenticate(input: Readonly<Record<string, string>>): Promise<PlatformOperationResult<unknown>>;
  disconnect(context: AdapterContext): Promise<PlatformOperationResult<void>>;
  getAccountInfo(context: AdapterContext): Promise<PlatformOperationResult<unknown>>;
  getContacts(context: AdapterContext): Promise<PlatformOperationResult<unknown[]>>;
  getFriends(context: AdapterContext): Promise<PlatformOperationResult<unknown[]>>;
  getGroups(context: AdapterContext): Promise<PlatformOperationResult<unknown[]>>;
  getGroupMembers(context: AdapterContext, groupId: string): Promise<PlatformOperationResult<unknown[]>>;
  sendMessage(context: AdapterContext, recipientId: string, content: string): Promise<PlatformOperationResult<{ platformMessageId: string }>>;
  sendMedia(context: AdapterContext, recipientId: string, mediaUrl: string): Promise<PlatformOperationResult<{ platformMessageId: string }>>;
  createPost(context: AdapterContext, payload: Readonly<Record<string, unknown>>): Promise<PlatformOperationResult<unknown>>;
  updatePost(context: AdapterContext, postId: string, payload: Readonly<Record<string, unknown>>): Promise<PlatformOperationResult<unknown>>;
  deletePost(context: AdapterContext, postId: string): Promise<PlatformOperationResult<void>>;
  getMessages(context: AdapterContext): Promise<PlatformOperationResult<unknown[]>>;
  getMessageHistory(context: AdapterContext, conversationId: string): Promise<PlatformOperationResult<unknown[]>>;
  createGroup(context: AdapterContext, name: string): Promise<PlatformOperationResult<unknown>>;
  addMember(context: AdapterContext, groupId: string, memberId: string): Promise<PlatformOperationResult<void>>;
  removeMember(context: AdapterContext, groupId: string, memberId: string): Promise<PlatformOperationResult<void>>;
  getAnalytics(context: AdapterContext): Promise<PlatformOperationResult<unknown>>;
  refreshData(context: AdapterContext): Promise<PlatformOperationResult<unknown>>;
}

export abstract class OfficialApiAdapter implements PlatformAdapter {
  abstract readonly platform: Platform;
  protected abstract readonly matrix: CapabilityMatrix;
  protected abstract configured(): boolean;

  capabilities(): CapabilityMatrix {
    return this.matrix;
  }

  isConfigured(): boolean {
    return this.configured();
  }

  protected unavailable<T>(capability: PlatformCapability): PlatformOperationResult<T> {
    if (!this.configured()) {
      return { status: 'NOT_CONFIGURED', errorCode: 'PLATFORM_NOT_CONFIGURED', message: `${this.platform} credentials are not configured.` };
    }
    if (this.matrix[capability] !== 'SUPPORTED') {
      return { status: 'NOT_SUPPORTED', errorCode: 'PLATFORM_NOT_SUPPORTED', message: `${capability} is not supported by the configured official API.` };
    }
    return { status: 'FAILED', errorCode: 'PLATFORM_UNAVAILABLE', message: 'Official API client is unavailable.' };
  }

  async authenticate(_input: Readonly<Record<string, string>>): Promise<PlatformOperationResult<unknown>> { return this.unavailable('AUTHENTICATE'); }
  async disconnect(_context: AdapterContext): Promise<PlatformOperationResult<void>> { return this.unavailable('AUTHENTICATE'); }
  async getAccountInfo(_context: AdapterContext): Promise<PlatformOperationResult<unknown>> { return this.unavailable('AUTHENTICATE'); }
  async getContacts(_context: AdapterContext): Promise<PlatformOperationResult<unknown[]>> { return this.unavailable('CONTACTS'); }
  async getFriends(_context: AdapterContext): Promise<PlatformOperationResult<unknown[]>> { return this.unavailable('FRIENDS'); }
  async getGroups(_context: AdapterContext): Promise<PlatformOperationResult<unknown[]>> { return this.unavailable('GROUPS'); }
  async getGroupMembers(_context: AdapterContext, _groupId: string): Promise<PlatformOperationResult<unknown[]>> { return this.unavailable('GROUP_MEMBERS'); }
  async sendMessage(_context: AdapterContext, _recipientId: string, _content: string): Promise<PlatformOperationResult<{ platformMessageId: string }>> { return this.unavailable('MESSAGING'); }
  async sendMedia(_context: AdapterContext, _recipientId: string, _mediaUrl: string): Promise<PlatformOperationResult<{ platformMessageId: string }>> { return this.unavailable('MEDIA'); }
  async createPost(_context: AdapterContext, _payload: Readonly<Record<string, unknown>>): Promise<PlatformOperationResult<unknown>> { return this.unavailable('POST_CREATE'); }
  async updatePost(_context: AdapterContext, _postId: string, _payload: Readonly<Record<string, unknown>>): Promise<PlatformOperationResult<unknown>> { return this.unavailable('POST_UPDATE'); }
  async deletePost(_context: AdapterContext, _postId: string): Promise<PlatformOperationResult<void>> { return this.unavailable('POST_DELETE'); }
  async getMessages(_context: AdapterContext): Promise<PlatformOperationResult<unknown[]>> { return this.unavailable('MESSAGE_HISTORY'); }
  async getMessageHistory(_context: AdapterContext, _conversationId: string): Promise<PlatformOperationResult<unknown[]>> { return this.unavailable('MESSAGE_HISTORY'); }
  async createGroup(_context: AdapterContext, _name: string): Promise<PlatformOperationResult<unknown>> { return this.unavailable('GROUP_CREATE'); }
  async addMember(_context: AdapterContext, _groupId: string, _memberId: string): Promise<PlatformOperationResult<void>> { return this.unavailable('GROUP_MEMBER_MANAGE'); }
  async removeMember(_context: AdapterContext, _groupId: string, _memberId: string): Promise<PlatformOperationResult<void>> { return this.unavailable('GROUP_MEMBER_MANAGE'); }
  async getAnalytics(_context: AdapterContext): Promise<PlatformOperationResult<unknown>> { return this.unavailable('ANALYTICS'); }
  async refreshData(_context: AdapterContext): Promise<PlatformOperationResult<unknown>> { return this.unavailable('ANALYTICS'); }
}
