# Báo cáo hoàn thiện Phase 1–8

Ngày cập nhật: 2026-08-13.

## Phase 1–2 — Nền tảng multi-tenant SaaS

Đã hoàn thành monorepo Next.js/NestJS/worker/scheduler, PostgreSQL/Redis/MinIO/Nginx, JWT access/refresh rotation, Argon2, RBAC, tenant isolation, SUPER_ADMIN, plan/subscription/quota, support session và emergency stop toàn hệ thống.

## Phase 3 — Data Import Center

Đã hoàn thành pipeline server-side: multipart upload, SHA-256 chống nhập lặp, CSV streaming, XLSX/XLS/JSON parser có giới hạn bộ nhớ, tự nhận diện cột tiếng Việt, mapping chỉnh sửa, chuẩn hóa số điện thoại, validation, dedupe trong file và trong tenant, preview theo trạng thái, commit vào BullMQ, worker theo batch, progress, lịch sử import và tải CSV lỗi. Giới hạn mặc định: CSV 100 MB, XLSX 50 MB, XLS/JSON 20 MB, 1 triệu dòng.

## Phase 4 — CRM, tag, segment, consent

Đã hoàn thành contact CRUD, tìm kiếm/lọc/pagination, tag, segment động, segment preview, thao tác hàng loạt gắn tag/opt-in/opt-out/suppression/archive, xuất CSV, consent history và tenant/global suppression. Mọi chiến dịch quảng bá kiểm tra lại consent và suppression ngay trước khi gửi.

## Phase 5 — Zalo OA & account operations

Đã hoàn thành OAuth v4 + PKCE/state một lần, callback server-side, domain verify, AES-256-GCM credentials, refresh-token rotation, account health, sync history, webhook verification/replay protection và dashboard SUPER_ADMIN cho toàn bộ OA. Có nút dừng/mở outbound theo từng OA; worker từ chối account không ở trạng thái CONNECTED.

Lưu ý: hệ thống chỉ dùng Zalo Official Account API chính thức. Những API/capability chưa được Zalo cấp sẽ trả `NOT_CONFIGURED`, `PERMISSION_REQUIRED` hoặc `NOT_SUPPORTED`; không giả lập thành công và không tự động hóa Zalo cá nhân.

## Phase 6 — Inbox, template, campaign, queue

Đã hoàn thành unified inbox, lịch sử message/event, template version/preview, campaign tĩnh hoặc từ segment tối đa 50.000 contact, approve/schedule/launch, fan-out nền, pause/resume/cancel, idempotency, exponential retry, per-account rate limit và dead-letter queue. Emergency stop tồn tại ở ba cấp: toàn hệ thống, tenant và account.

## Phase 7 — Analytics, usage, notification, audit

Đã hoàn thành dashboard tenant/admin, usage so với quota, analytics contact/message/campaign/post/queue, xuất CSV và in/PDF từ trình duyệt, notification trong ứng dụng, subscription warning/expiry, queue overview và audit log cho thao tác nhạy cảm.

## Phase 8 — Security, performance, backup, monitoring

Đã hoàn thành Helmet/CSP, CORS allow-list, DTO whitelist, throttling, secret fail-fast, mã hóa token, webhook signature, file-size/type limit, streaming CSV/batch database, Prometheus metrics, structured logs, health/readiness, retention scheduler, backup/restore scripts, disaster-recovery runbook, Docker Compose dev/prod và k6 smoke profile. Production dependency audit hiện có 0 vulnerability.

## Acceptance coverage

- Tenant A không thể truy cập resource Tenant B; có test tenant isolation.
- Subscription hết hạn hoặc tenant/OA bị dừng vẫn đọc dữ liệu được nhưng outbound bị chặn.
- Contact quảng bá phải `OPTED_IN`, không suppressed và có permission thật tại thời điểm worker gửi.
- Tệp import lỗi có preview, trạng thái từng dòng và CSV lỗi; job có retry + DLQ.
- Production deploy chạy migration trước API/worker/scheduler và có readiness trước khi nhận traffic.
