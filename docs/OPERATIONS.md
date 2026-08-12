# Operations

## Health and observability

- API liveness: `/api/v1/health`
- API readiness (PostgreSQL + Redis): `/api/v1/ready`
- Prometheus text: `/api/v1/metrics`
- Worker health: port `4101`
- Scheduler health: port `4102`
- Nginx health: `/nginx-health`

Log API/Nginx có cấu trúc JSON. Theo dõi BullMQ `waiting/active/failed/delayed`, campaign failure rate, adapter rate limit và DB connection saturation.

## Migration

API container chạy `prisma migrate deploy` trước khi start. Production workflow nên:

1. Chụp backup và kiểm tra restore gần nhất.
2. Build image immutable theo commit SHA.
3. Chạy migration job một lần.
4. Deploy API/worker/scheduler/web.
5. Kiểm tra readiness và smoke test register/login/read workspace.

## Backup / restore

```powershell
npm run backup
npm run restore -- -BackupFile .\backups\postgres-YYYYMMDD-HHMMSS.sql
```

Script mặc định dùng database/user dev. Với production, dùng credential/backup service quản lý riêng, mã hóa file, kiểm tra checksum và thử restore định kỳ. MinIO bucket cần versioning/replication độc lập với backup DB.

## Incident actions

- Platform rate limit: pause campaign, không tăng concurrency để né giới hạn, chờ `Retry-After`/quota reset.
- Credential compromise: disconnect account, revoke token tại platform, rotate app secret và review audit.
- Queue poison job: giữ failed job để điều tra, sửa root cause rồi retry có kiểm soát; không xóa hàng loạt.
- Database degradation: chuyển API khỏi traffic bằng readiness, bảo toàn PostgreSQL trước khi restart service phụ thuộc.

## Scaling

Scale worker ngang; giữ scheduler một replica hoặc dùng leader election. BullMQ job ID/idempotency bảo vệ duplicate, nhưng mọi consumer vẫn phải giữ transaction và safety recheck. Nginx có thể thay bằng managed load balancer/TLS ingress.

## Zalo OA webhook

Endpoint production: `POST /api/v1/platforms/zalo/webhook`. Cấu hình cùng `ZALO_CLIENT_ID` và `ZALO_OA_SECRET_KEY`; endpoint từ chối sai app ID, chữ ký sai hoặc timestamp ngoài cửa sổ chống replay. Event hợp lệ được lưu trước, deduplicate và đưa vào queue `webhook.process`; HTTP request không xử lý inbox đồng bộ.

Khi rotate OA secret: cập nhật Render/secret manager, redeploy, sau đó gửi một event thử và kiểm tra `WebhookEvent`, `BackgroundJob`, queue metrics cùng inbox tenant. Không ghi raw secret hoặc token vào ticket/log.
