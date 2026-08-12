# ZaloHub SaaS

Nền tảng quản lý Zalo Official Account đa tenant, có kiểm soát consent, subscription/quota và xử lý outbound hoàn toàn qua Redis/BullMQ worker. Hệ thống chỉ dùng OAuth/OpenAPI/webhook chính thức; không thu thập cookie, không tự động hóa Zalo cá nhân và không giả lập thành công khi API chưa được cấp quyền.

## Trạng thái sản phẩm

- Multi-tenant: mọi contact, tài khoản, hội thoại, tin nhắn, template và campaign đều được scope theo `workspaceId`; có test chặn Tenant A đọc Tenant B.
- Phân quyền: `SUPER_ADMIN` hệ thống và `OWNER/ADMIN/MANAGER/OPERATOR/VIEWER` trong tenant; support session có banner và audit.
- SaaS control plane: tenant, plan, subscription, expiration, quota, usage, suspension, emergency outbound kill switch và global suppression.
- Zalo OA: OAuth v4 + PKCE, token AES-256-GCM, refresh-token rotation, gửi tin tư vấn chính thức qua worker, webhook có xác thực chữ ký/replay protection/deduplication.
- CRM/campaign: contact, consent history, suppression, import CSV/JSON/XLSX, audience snapshot, phê duyệt, schedule, pause/resume/cancel, retry/backoff/rate limit/idempotency.
- Vận hành: audit, notification in-app, analytics, queue/worker health, migration, backup/restore và Docker production.

Facebook/TikTok chỉ còn adapter/capability gate và trả `NOT_CONFIGURED` hoặc `NOT_SUPPORTED`; chúng không nằm trong luồng gửi production của ZaloHub.

## Chạy bằng Docker

Yêu cầu Docker Desktop + Compose v2 và khoảng 8 GB RAM trống.

```powershell
Copy-Item .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
docker compose exec omnisocial-api npm run db:seed
```

- Web qua Nginx: `http://localhost:8080`
- API health: `http://localhost:8080/api/v1/health`
- Swagger: `http://localhost:8080/api/docs`
- MinIO Console (dev): `http://localhost:9001`

Seed chỉ dành cho local:

```text
owner@demo.local / DemoPass!2026
```

Production không seed demo. Có thể bootstrap lần đầu bằng `BOOTSTRAP_SUPER_ADMIN_EMAIL` và `BOOTSTRAP_SUPER_ADMIN_PASSWORD`, sau đó xóa hai biến khỏi môi trường.

## Phát triển

```powershell
npm install
npm run db:generate
npm run typecheck
npm run lint
npm test
npm run build
npm run compose:config
```

## Cấu hình Zalo OA

Các biến bắt buộc:

```text
ZALO_CLIENT_ID=<App ID>
ZALO_CLIENT_SECRET=<App secret>
ZALO_OA_SECRET_KEY=<OA secret dùng kiểm tra webhook>
ZALO_REDIRECT_URI=https://tool-messager-api.onrender.com/api/v1/platforms/zalo/oauth/callback
FRONTEND_URL=https://lou-trinh.github.io/tool-messager
```

Trong Zalo Developers:

1. Xác thực domain `tool-messager-api.onrender.com`.
2. Đăng ký callback OA đúng bằng URL ở trên.
3. Đăng ký webhook `https://tool-messager-api.onrender.com/api/v1/platforms/zalo/webhook` và chọn các event tin nhắn/người dùng cần thiết.
4. Chỉ cấp các quyền thực sự dùng: thông tin OA, người dùng, tin nhắn và các webhook tương ứng.
5. Tenant đăng nhập ZaloHub, chọn **Tài khoản → Kết nối Zalo OA** và cấp quyền cho OA mình sở hữu/quản trị.

`ZALO_CLIENT_SECRET`, `ZALO_OA_SECRET_KEY`, access/refresh token và PKCE verifier không được trả về UI hay ghi vào log.

## Kiến trúc

```text
Browser → Next.js → NestJS API → PostgreSQL
                        │
                        ├→ Redis/BullMQ → worker → Zalo OA OpenAPI
                        ├→ scheduler    → queues
                        └← verified Zalo webhook → webhook queue → inbox/consent
```

Monorepo:

- `apps/web`: Tenant UI và SUPER_ADMIN control plane.
- `apps/api`: JWT rotation, RBAC, tenant policy, REST/OpenAPI và webhook.
- `apps/worker`: contact import, campaign fan-out, gửi tin và xử lý webhook.
- `apps/scheduler`: campaign/subscription/notification jobs đến hạn.
- `packages/platform-zalo`: adapter Zalo OA chính thức.
- `prisma`: schema, migration, seed và bootstrap admin.
- `infrastructure`, `docker-compose*.yml`: local/production containers.

Xem [kiến trúc](docs/ARCHITECTURE.md), [bảo mật](docs/SECURITY.md), [vận hành](docs/OPERATIONS.md), [khôi phục thảm họa](docs/DISASTER_RECOVERY.md) và [báo cáo phase](docs/PHASE_REPORT.md).

## Deploy hiện tại

- Frontend: <https://lou-trinh.github.io/tool-messager/>
- API: <https://tool-messager-api.onrender.com/api/v1>

GitHub Pages lấy `NEXT_PUBLIC_API_URL` từ repository variable. Render chạy API + worker + scheduler trong một image để phù hợp môi trường demo; cấu hình Docker Compose production vẫn tách riêng từng service và cho phép scale worker độc lập.

## Giới hạn đã biết

- WebSocket realtime, email notification, payment provider và full media upload chưa được kích hoạt ở deploy công khai; trạng thái hiện tại dùng polling/in-app và kiến trúc billing-ready.
- Import XLS cũ không được đọc trực tiếp; lưu lại thành XLSX. Mapping hiện dựa trên tên cột chuẩn/alias và có validation, chưa có màn hình kéo-thả column mapping.
- API Zalo và khả năng gửi phụ thuộc app review, scope, trạng thái OA và chính sách Zalo. Không có quyền thì hệ thống trả lỗi thật, không giả lập success.
- Render free có cold start và datastore miễn phí không phù hợp SLA production.

## License

Proprietary / `UNLICENSED`.
