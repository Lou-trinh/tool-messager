# Báo cáo triển khai theo phase

Ngày cập nhật: 2026-08-12.

## Phase 1 — Monorepo, Docker, auth, RBAC, tenant

Hoàn thành core: npm workspaces, Next/Nest/worker/scheduler, PostgreSQL/Redis/MinIO/Nginx Compose, JWT access/refresh rotation, Argon2, role tenant và tenant boundary. Test cô lập tenant chứng minh thành viên Tenant A bị từ chối trước khi query resource Tenant B.

## Phase 2 — SUPER_ADMIN, tenant, plan, subscription, quota

Hoàn thành: dashboard thống kê, CRUD/activation/suspension tenant, tạo owner, plan/quota override, subscription lifecycle, usage, reset password, support session có thời hạn, global kill switch và global suppression. Audit log hệ thống cho thao tác nhạy cảm.

## Phase 3 — Zalo OA

Hoàn thành: OAuth v4 + PKCE/state một lần, domain/callback server-side, AES-256-GCM credentials, token rotation, account health, gửi tin tư vấn qua OpenAPI, webhook signature + replay window + event deduplication. Adapter trả `NOT_CONFIGURED`/`PERMISSION_REQUIRED` thay vì success giả.

## Phase 4 — Contacts, import, consent, suppression

Hoàn thành core: contact/tags/consent history, tenant/global suppression, validation CSV/JSON/XLSX, duplicate upsert và contact import chạy background queue. Import không tự chuyển consent thành `OPTED_IN`; opt-out webhook lập tức khóa gửi.

Giới hạn: UI mapping cột dạng wizard kéo-thả chưa có; parser dùng cột chuẩn/alias. File `.xls` legacy phải đổi sang `.xlsx`.

## Phase 5 — Inbox, message, template, history

Hoàn thành core: conversation/message/event persistence, inbox webhook, lịch sử và composer queue-based; template CRUD/version/preview; content states. Tin outbound từ composer vẫn qua compliance layer và worker.

Giới hạn: media upload production chưa được cấu hình S3 ở deploy công khai.

## Phase 6 — Campaign, queue, worker, scheduler

Hoàn thành: audience snapshot, consent/suppression validation, approve/schedule/launch, background fan-out, pause/resume/cancel, account/platform limit, exponential backoff, retry-after, idempotency và dead-letter retention. Emergency stop được kiểm tra cả khi queue và ngay trước API send.

## Phase 7 — Analytics, notification, audit, usage

Hoàn thành core: tenant/admin analytics, plan progress, notification in-app, account/campaign/subscription events, queue overview, worker health và audit. Realtime hiện dùng polling; WebSocket và email/webhook notification outbound là phần mở rộng chưa kích hoạt.

## Phase 8 — Security, backup, monitoring, production Docker

Hoàn thành: Helmet/CORS/validation/throttling, secret fail-fast, encrypted tokens, webhook verification, Prometheus text metrics, structured logs, backup/restore scripts, DR runbook và Compose dev/prod. Render demo gộp process; Compose production tách api/worker/scheduler để scale.

## Phase 9 — Testing và tài liệu

Quality gates đã chạy trên worktree 2026-08-12: 27 tests/10 files, lint không warning, toàn bộ workspace typecheck và Next/Nest/worker/scheduler production build. Docker Compose config hợp lệ. Security dependency audit và image build được ghi lại trong handoff/deploy tương ứng.

## Acceptance coverage

- Tạo tenant + owner + subscription: SUPER_ADMIN API/UI.
- BASIC/PRO quota: policy service và admin plan editor.
- Kết nối Zalo: OAuth OA thật; cần OA thuộc/quản trị bởi tài khoản Zalo đăng nhập.
- Import/contact/consent/template/campaign: UI + API + queue worker.
- Tenant A đọc resource Tenant B: `403 Forbidden`, có integration-style service test.
- Subscription hết hạn hoặc tenant suspended: login/read vẫn dùng được, outbound bị chặn.
- Không có Zalo permission/config: trả trạng thái/lỗi thật, không fake success.
