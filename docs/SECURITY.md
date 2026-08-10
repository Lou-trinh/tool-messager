# Security

## Controls

- Argon2 password hashing; access JWT 15 phút; refresh token hash lưu DB và rotation sau mỗi refresh.
- Workspace-scoped authorization và role checks ở service layer.
- `class-validator` whitelist + reject unknown fields, global throttling, Helmet CSP, CORS allowlist.
- Consent, opt-out/suppression, platform capability và permission được kiểm tra trước queue và kiểm tra lại trong worker.
- Proxy credentials mã hóa AES-256-GCM bằng `ENCRYPTION_KEY`; API chỉ trả metadata không nhạy cảm.
- Audit event cho auth/workspace/account/contact/campaign/template/automation/post/proxy và sync quan trọng.
- Production fail-fast nếu application secret thiếu, ngắn hoặc còn placeholder.

## Secret handling

Không commit `.env`. Production nên inject secret từ Docker/Kubernetes secret manager hoặc vault, luân chuyển JWT/refresh/encryption key theo runbook riêng. Việc đổi `ENCRYPTION_KEY` cần decrypt/re-encrypt credential trước khi thay key cũ.

## Platform compliance

Không đưa cookie/session cá nhân, proxy rotation, scraping, anti-detection hoặc CAPTCHA bypass vào adapter. Chỉ bật scope đã được app review. Promotional message yêu cầu `OPTED_IN`; mọi `OPTED_OUT`/suppressed contact bị block kể cả job đã nằm trong queue.

## Data privacy

Contact export yêu cầu role hợp lệ và được audit ở hạ tầng truy cập. Không log JWT, refresh token, password, access token hay proxy credential. Thiết lập retention/erasure theo chính sách tổ chức trước production.

## Reporting

Không tạo public issue chứa secret hoặc dữ liệu cá nhân. Báo cáo riêng cho maintainer kèm phiên bản, tác động và bước tái hiện tối thiểu.
