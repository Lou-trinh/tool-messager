import { Controller, Get, Header } from '@nestjs/common';

export const ZALO_SITE_VERIFICATION_PATH =
  'zalo_verifierIE-t1CxHP25EyC8daUDj07ALoXIUun1FDp8u.html';

const ZALO_SITE_VERIFICATION_DOCUMENT = `<!DOCTYPE html>
<html lang="en">

<head>
    <meta property="zalo-platform-site-verification" content="IE-t1CxHP25EyC8daUDj07ALoXIUun1FDp8u" />
</head>

<body>
There Is No Limit To What You Can Accomplish Using Zalo!
</body>

</html>`;

@Controller()
export class SiteVerificationController {
  @Get(ZALO_SITE_VERIFICATION_PATH)
  @Header('Content-Type', 'text/html; charset=utf-8')
  verifyZaloDomain(): string {
    return ZALO_SITE_VERIFICATION_DOCUMENT;
  }
}
