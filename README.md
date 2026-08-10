# OmniSocial

Nền tảng quản trị social đa tenant, consent-aware và queue-based cho Zalo, Facebook và TikTok. Hệ thống chỉ làm việc qua official API adapter; không scraping, không giả lập thành công và không có cơ chế né rate limit/chính sách nền tảng.

## Chạy nhanh bằng Docker

Yêu cầu: Docker Desktop có Compose v2, tối thiểu 8 GB RAM trống.

```powershell
Copy-Item .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
docker compose exec omnisocial-api npm run db:seed
```

Sau khi healthcheck đạt trạng thái healthy:

- Web: http://localhost:8080
- API health: http://localhost:8080/api/v1/health
- Swagger UI / OpenAPI 3.1: http://localhost:8080/api/docs
- MinIO Console (dev overlay): http://localhost:9001

Tài khoản seed cục bộ:

```text
Email: owner@demo.local
Password: DemoPass!2026
```

Dữ liệu seed hoàn toàn tổng hợp. Không dùng tài khoản trên môi trường công khai và không bật seed trong production.

## Kiến trúc

```text
Browser → Nginx → Next.js 16
               └→ NestJS API → PostgreSQL 16
                              → Redis / BullMQ → Worker
                              → Scheduler      → Worker
                              → MinIO / S3-compatible storage
                              → PlatformAdapter → Zalo | Facebook | TikTok official API
```

Monorepo gồm:

- `apps/web`: dashboard Next.js, React Query, Zustand, Tailwind.
- `apps/api`: REST API NestJS, JWT rotation, validation, RBAC, Swagger UI.
- `apps/worker`: message/campaign/post consumers với retry, rate limiter và idempotency.
- `apps/scheduler`: poll campaign/post đến hạn và đưa vào BullMQ.
- `packages/platform-*`: adapter tách biệt khỏi core domain.
- `packages/shared`: schema/safety policy dùng chung.
- `prisma`: schema, migration và seed.
- `infrastructure`: Dockerfile và Nginx reverse proxy.

Xem thêm [kiến trúc](docs/ARCHITECTURE.md), [bảo mật](docs/SECURITY.md) và [vận hành](docs/OPERATIONS.md).

## Chức năng đã triển khai

- Auth: register, login, access/refresh JWT, refresh rotation, logout một/all session, quên/đặt lại mật khẩu, email verification readiness.
- Workspace: multi-tenant isolation, thành viên, invitation, role `OWNER/ADMIN/MANAGER/OPERATOR/VIEWER`.
- Social accounts: capability matrix và adapter chính thức cho Zalo/Facebook/TikTok.
- CRM: contacts, consent/opt-out, suppression, tags, import tối đa 5.000 dòng, CSV export.
- Inbox: conversations, history, outbound queue với consent/permission/capability/rate checks.
- Campaign: audience snapshot, approval, schedule/launch, idempotent per-contact delivery.
- Templates và automation: CRUD, version/state và trigger/action cấu hình thật trong PostgreSQL.
- Content: draft, approval, immediate queue, schedule, calendar và worker publishing.
- Groups: dữ liệu thành viên và official-API sync có capability detection.
- Proxy: metadata, account assignment, AES-256-GCM encryption; secret không được trả qua API.
- Analytics, audit log, readiness/liveness, Prometheus text metrics, backup/restore.

## Official API và trạng thái capability

Repo không chứa credential thật. Khi thiếu client ID/secret, adapter trả `NOT_CONFIGURED`. Khi official API không cung cấp capability, adapter trả `NOT_SUPPORTED` hoặc `PERMISSION_REQUIRED`; không có đường code nào giả lập gửi/publish thành công.

Để tích hợp production, điền biến `ZALO_*`, `FACEBOOK_*`, `TIKTOK_*` và hiện thực OAuth/API client tương ứng theo tài liệu chính thức cùng app review/permission của từng nền tảng. Capability matrix tại `/api/v1/platforms/capabilities` là nguồn sự thật cho UI và service.

## Phát triển cục bộ

```powershell
npm install
npm run db:generate
npm run typecheck
npm run lint
npm test
npm run build
```

Có thể chạy infrastructure riêng rồi khởi động app bằng `npm run dev`:

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis minio
Copy-Item .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

## Production

Không dùng giá trị mặc định trong `.env.example`. Tạo secret ngẫu nhiên tối thiểu 32 ký tự cho `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`; đặt mật khẩu Postgres/MinIO riêng và TLS ở load balancer/reverse proxy.

```powershell
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Production overlay bắt buộc ba application secret và API sẽ fail-fast nếu nhận placeholder. Migration chạy tự động trước khi API lắng nghe. Backup trước mỗi migration; xem `docs/OPERATIONS.md`.

### Render demo miễn phí

[`render.yaml`](render.yaml) tạo một web service chạy chung API, worker và scheduler, kèm Render Postgres và Render Key Value. Blueprint tự sinh các application secret, chạy migration và nạp dữ liệu demo idempotent trước khi khởi động.

Sau khi Render cấp URL HTTPS cho API:

1. Tạo repository variable `NEXT_PUBLIC_API_URL` với giá trị `https://<render-host>/api/v1`.
2. Chạy lại workflow `Deploy frontend to GitHub Pages`.
3. Đăng nhập bằng `owner@demo.local` / `DemoPass!2026`.

Đây chỉ là môi trường demo: web service miễn phí có thể sleep khi không hoạt động, Key Value miễn phí không lưu dữ liệu qua restart và PostgreSQL miễn phí của Render hết hạn sau 30 ngày. Khi chuyển sang production thật, đặt `SEED_DEMO_DATA=false`, đổi mật khẩu demo và nâng datastore lên gói có persistence/backup.

## Quality gates

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm audit --omit=dev
docker compose config --quiet
```

## Giới hạn có chủ đích

- Không gửi theo số điện thoại nếu official API không hỗ trợ ánh xạ recipient hợp lệ.
- Không scraping session/cookie, browser automation, bypass CAPTCHA hoặc xoay proxy để né giới hạn.
- SMTP không cấu hình sẽ trả `NOT_CONFIGURED`; ở non-production token dev được trả để kiểm thử flow.
- OAuth HTTP client thực tế phụ thuộc credential, app review và scope được nền tảng cấp. Các adapter hiện đã có interface, capability detection, configuration gate và lỗi rõ ràng để tích hợp mà không sửa core service.

## Kết nối Zalo Official Account

Luồng Zalo OA dùng OAuth v4 + PKCE và callback server-side. Authorization state/code verifier chỉ dùng một lần và được lưu mã hóa; access token cùng refresh token được mã hóa AES-256-GCM. Hệ thống tự làm mới token khi tài khoản sắp hết hạn và lưu refresh token mới sau mỗi lần rotation.

1. Tạo và kích hoạt Zalo App tại `https://developers.zalo.me`.
2. Trong phần Zalo OA OpenAPI, khai báo callback URL chính xác:
   `https://tool-messager-api.onrender.com/api/v1/platforms/zalo/oauth/callback`
3. Yêu cầu tối thiểu quyền quản lý thông tin OA. Các quyền nhắn tin, người dùng, bài viết phải được chọn/xét duyệt theo chức năng cần dùng.
4. Trên Render Web Service, thêm secret `ZALO_CLIENT_ID` (App ID) và `ZALO_CLIENT_SECRET` (Secret key), sau đó redeploy.
5. Đăng nhập OmniSocial, vào **Tài khoản** và chọn **Kết nối Zalo OA**.

Các biến liên quan:

```text
FRONTEND_URL=https://lou-trinh.github.io/tool-messager
ZALO_CLIENT_ID=<zalo-app-id>
ZALO_CLIENT_SECRET=<zalo-secret-key>
ZALO_REDIRECT_URI=https://tool-messager-api.onrender.com/api/v1/platforms/zalo/oauth/callback
```

`ZALO_CLIENT_SECRET`, access token, refresh token và code verifier không được trả về frontend hoặc ghi vào log.

## License

Proprietary / `UNLICENSED`.
