const ok = { description: 'Successful response.' };
const accepted = { description: 'Accepted for asynchronous processing.' };
const errorResponses = {
  400: { description: 'Validation or business-rule error.' },
  401: { description: 'Authentication required.' },
  403: { description: 'Insufficient workspace permission.' },
  404: { description: 'Resource not found in this workspace.' },
  429: { description: 'Rate limit exceeded.' },
};
const bearer = [{ bearerAuth: [] }];
const workspaceParameter = {
  name: 'workspaceId',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'OmniSocial API',
    version: '0.1.0',
    description: 'Consent-aware social operations API. Platform actions use official APIs only.',
  },
  servers: [{ url: '/api/v1' }],
  tags: ['auth', 'workspaces', 'accounts', 'contacts', 'messages', 'campaigns', 'platforms', 'audit', 'health'].map((name) => ({ name })),
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      RegisterRequest: {
        type: 'object',
        required: ['email', 'password', 'displayName', 'workspaceName'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 12, format: 'password' },
          displayName: { type: 'string', minLength: 2, maxLength: 100 },
          workspaceName: { type: 'string', minLength: 2, maxLength: 100 },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', format: 'password' }, sessionName: { type: 'string' } },
      },
      TokenPair: {
        type: 'object',
        properties: { accessToken: { type: 'string' }, refreshToken: { type: 'string' }, expiresInSeconds: { type: 'integer' } },
      },
      ErrorEnvelope: {
        type: 'object',
        required: ['success', 'error'],
        properties: { success: { const: false }, error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' } } } },
      },
    },
  },
  paths: {
    '/auth/register': { post: { tags: ['auth'], summary: 'Register user and first workspace', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } } } }, responses: { 201: ok, ...errorResponses } } },
    '/auth/login': { post: { tags: ['auth'], summary: 'Login', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } }, responses: { 201: ok, ...errorResponses } } },
    '/auth/refresh': { post: { tags: ['auth'], summary: 'Rotate refresh token', responses: { 201: ok, ...errorResponses } } },
    '/auth/logout': { post: { tags: ['auth'], summary: 'Revoke current refresh session', security: bearer, responses: { 201: ok, ...errorResponses } } },
    '/auth/logout-all': { post: { tags: ['auth'], summary: 'Revoke all refresh sessions', security: bearer, responses: { 201: ok, ...errorResponses } } },
    '/auth/sessions': { get: { tags: ['auth'], summary: 'List active sessions', security: bearer, responses: { 200: ok, ...errorResponses } } },
    '/auth/me': { get: { tags: ['auth'], summary: 'Get current user', security: bearer, responses: { 200: ok, ...errorResponses } } },
    '/auth/forgot-password': { post: { tags: ['auth'], summary: 'Request password reset', responses: { 201: accepted, ...errorResponses } } },
    '/auth/reset-password': { post: { tags: ['auth'], summary: 'Reset password', responses: { 201: ok, ...errorResponses } } },
    '/auth/email-verification/request': { post: { tags: ['auth'], summary: 'Request email verification', security: bearer, responses: { 201: accepted, ...errorResponses } } },
    '/auth/email-verification/verify': { post: { tags: ['auth'], summary: 'Verify email token', responses: { 201: ok, ...errorResponses } } },
    '/workspaces': {
      get: { tags: ['workspaces'], summary: 'List memberships', security: bearer, responses: { 200: ok, ...errorResponses } },
      post: { tags: ['workspaces'], summary: 'Create workspace', security: bearer, responses: { 201: ok, ...errorResponses } },
    },
    '/workspaces/{workspaceId}': { get: { tags: ['workspaces'], summary: 'Workspace overview', security: bearer, parameters: [workspaceParameter], responses: { 200: ok, ...errorResponses } } },
    '/workspaces/{workspaceId}/members': { get: { tags: ['workspaces'], summary: 'List members', security: bearer, parameters: [workspaceParameter], responses: { 200: ok, ...errorResponses } } },
    '/workspaces/{workspaceId}/invitations': { post: { tags: ['workspaces'], summary: 'Invite member', security: bearer, parameters: [workspaceParameter], responses: { 201: ok, ...errorResponses } } },
    '/workspaces/{workspaceId}/accounts': {
      get: { tags: ['accounts'], summary: 'List social accounts', security: bearer, parameters: [workspaceParameter], responses: { 200: ok, ...errorResponses } },
      post: { tags: ['accounts'], summary: 'Create a disconnected official-API account record', security: bearer, parameters: [workspaceParameter], responses: { 201: ok, ...errorResponses } },
    },
    '/workspaces/{workspaceId}/accounts/{accountId}/sync': { post: { tags: ['accounts'], summary: 'Request account sync', security: bearer, parameters: [workspaceParameter, { name: 'accountId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { 201: accepted, ...errorResponses } } },
    '/workspaces/{workspaceId}/contacts': {
      get: { tags: ['contacts'], summary: 'Search and paginate contacts', security: bearer, parameters: [workspaceParameter], responses: { 200: ok, ...errorResponses } },
      post: { tags: ['contacts'], summary: 'Create contact with source and consent', security: bearer, parameters: [workspaceParameter], responses: { 201: ok, ...errorResponses } },
    },
    '/workspaces/{workspaceId}/contacts/import': { post: { tags: ['contacts'], summary: 'Import up to 5,000 consent-aware contacts', security: bearer, parameters: [workspaceParameter], responses: { 201: ok, ...errorResponses } } },
    '/workspaces/{workspaceId}/conversations': { get: { tags: ['messages'], summary: 'List conversations', security: bearer, parameters: [workspaceParameter], responses: { 200: ok, ...errorResponses } } },
    '/workspaces/{workspaceId}/conversations/{conversationId}/messages': { get: { tags: ['messages'], summary: 'Get conversation history', security: bearer, parameters: [workspaceParameter], responses: { 200: ok, ...errorResponses } } },
    '/workspaces/{workspaceId}/messages': { post: { tags: ['messages'], summary: 'Validate and queue an outbound message', security: bearer, parameters: [workspaceParameter], responses: { 201: accepted, ...errorResponses } } },
    '/workspaces/{workspaceId}/campaigns': {
      get: { tags: ['campaigns'], summary: 'List campaigns', security: bearer, parameters: [workspaceParameter], responses: { 200: ok, ...errorResponses } },
      post: { tags: ['campaigns'], summary: 'Create campaign and static audience', security: bearer, parameters: [workspaceParameter], responses: { 201: ok, ...errorResponses } },
    },
    '/workspaces/{workspaceId}/campaigns/{campaignId}/approve': { post: { tags: ['campaigns'], summary: 'Approve campaign', security: bearer, parameters: [workspaceParameter], responses: { 201: ok, ...errorResponses } } },
    '/workspaces/{workspaceId}/campaigns/{campaignId}/schedule': { post: { tags: ['campaigns'], summary: 'Schedule approved campaign', security: bearer, parameters: [workspaceParameter], responses: { 201: ok, ...errorResponses } } },
    '/workspaces/{workspaceId}/campaigns/{campaignId}/launch': { post: { tags: ['campaigns'], summary: 'Launch approved campaign', security: bearer, parameters: [workspaceParameter], responses: { 201: accepted, ...errorResponses } } },
    '/workspaces/{workspaceId}/templates': { get: { tags: ['messages'], summary: 'List versioned message templates', security: bearer, parameters: [workspaceParameter], responses: { 200: ok, ...errorResponses } }, post: { tags: ['messages'], summary: 'Create message template', security: bearer, parameters: [workspaceParameter], responses: { 201: ok, ...errorResponses } } },
    '/workspaces/{workspaceId}/automations': { get: { tags: ['campaigns'], summary: 'List automation workflows', security: bearer, parameters: [workspaceParameter], responses: { 200: ok, ...errorResponses } }, post: { tags: ['campaigns'], summary: 'Create versioned automation', security: bearer, parameters: [workspaceParameter], responses: { 201: ok, ...errorResponses } } },
    '/workspaces/{workspaceId}/posts': { get: { tags: ['campaigns'], summary: 'List social posts', security: bearer, parameters: [workspaceParameter], responses: { 200: ok, ...errorResponses } }, post: { tags: ['campaigns'], summary: 'Create draft social post', security: bearer, parameters: [workspaceParameter], responses: { 201: ok, ...errorResponses } } },
    '/workspaces/{workspaceId}/posts/{postId}/schedule': { post: { tags: ['campaigns'], summary: 'Approve and schedule post', security: bearer, parameters: [workspaceParameter], responses: { 201: accepted, ...errorResponses } } },
    '/workspaces/{workspaceId}/posts/{postId}/publish': { post: { tags: ['campaigns'], summary: 'Queue immediate official-API publish', security: bearer, parameters: [workspaceParameter], responses: { 201: accepted, ...errorResponses } } },
    '/workspaces/{workspaceId}/calendar': { get: { tags: ['campaigns'], summary: 'Get scheduled content range', security: bearer, parameters: [workspaceParameter], responses: { 200: ok, ...errorResponses } } },
    '/workspaces/{workspaceId}/groups': { get: { tags: ['contacts'], summary: 'List synchronized platform groups', security: bearer, parameters: [workspaceParameter], responses: { 200: ok, ...errorResponses } } },
    '/workspaces/{workspaceId}/proxies': { get: { tags: ['accounts'], summary: 'List proxy metadata without secrets', security: bearer, parameters: [workspaceParameter], responses: { 200: ok, ...errorResponses } }, post: { tags: ['accounts'], summary: 'Create encrypted proxy configuration', security: bearer, parameters: [workspaceParameter], responses: { 201: ok, ...errorResponses } } },
    '/workspaces/{workspaceId}/analytics': { get: { tags: ['audit'], summary: 'Get workspace and queue analytics', security: bearer, parameters: [workspaceParameter], responses: { 200: ok, ...errorResponses } } },
    '/workspaces/{workspaceId}/contacts-export.csv': { get: { tags: ['contacts'], summary: 'Export authorized workspace contacts as CSV', security: bearer, parameters: [workspaceParameter], responses: { 200: { description: 'UTF-8 CSV export.' }, ...errorResponses } } },
    '/platforms/capabilities': { get: { tags: ['platforms'], summary: 'Inspect conservative official-API capability matrix', security: bearer, responses: { 200: ok, ...errorResponses } } },
    '/workspaces/{workspaceId}/audit': { get: { tags: ['audit'], summary: 'Read immutable audit events', security: bearer, parameters: [workspaceParameter], responses: { 200: ok, ...errorResponses } } },
    '/health': { get: { tags: ['health'], summary: 'Liveness probe', responses: { 200: ok } } },
    '/ready': { get: { tags: ['health'], summary: 'Database and Redis readiness probe', responses: { 200: ok, 503: { description: 'Dependency unavailable.' } } } },
  },
} as const;
