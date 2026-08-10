# Architecture

## Boundaries

Core modules không import SDK Zalo/Facebook/TikTok. Mọi thao tác nền tảng đi qua `PlatformAdapter` và `PlatformRegistryService`. Việc thêm nền tảng mới chỉ cần package adapter, đăng ký registry và capability matrix.

Mỗi bảng dữ liệu nghiệp vụ có `workspaceId` hoặc quan hệ bắt buộc dẫn về workspace. Service luôn gọi `assertMembership` trước truy vấn/mutation và filter theo `workspaceId`, tránh IDOR giữa tenant.

## Message execution

```text
API request
  → DTO validation
  → workspace/RBAC
  → account + contact lookup inside workspace
  → capability + permission + consent + suppression + rate check
  → idempotency record
  → BullMQ
  → worker repeats safety check
  → official adapter
  → status + BackgroundJob + audit/metrics
```

Campaign tạo audience snapshot. Mỗi recipient dùng idempotency key `campaign:{campaignId}:contact:{contactId}`. Retry không tạo bản gửi thứ hai.

## Scheduler

Scheduler stateless poll bản ghi `SCHEDULED` đến hạn mỗi 30 giây. Job ID xác định (`schedule-campaign-*`, `schedule-post-*`) ngăn duplicate khi nhiều tick hoặc restart. Có thể chạy một scheduler và scale worker độc lập.

## Persistence

- PostgreSQL/Prisma: system of record.
- Redis/BullMQ: durable job state và per-worker limiter.
- MinIO/S3: media binary; DB chỉ lưu object key/checksum/metadata.
- AuditLog: append-only từ API/service; không có endpoint update/delete.

## Failure semantics

Adapter chỉ trả `SUCCESS` khi official client trả thành công. Thiếu cấu hình → `NOT_CONFIGURED`; capability không có → `NOT_SUPPORTED`; thiếu scope → `PERMISSION_REQUIRED`; lỗi upstream → `FAILED`. Worker dùng exponential retry và chỉ đánh dấu `FAILED` sau attempt cuối.
