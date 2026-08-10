import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ZaloOAuthCallbackDto } from './accounts.dto';
import { ZaloOAuthService } from './zalo-oauth.service';

@Controller('platforms/zalo/oauth')
export class ZaloOAuthController {
  constructor(private readonly oauth: ZaloOAuthService) {}

  @Get('callback')
  async callback(@Query() query: ZaloOAuthCallbackDto, @Res() response: Response): Promise<void> {
    try {
      response.redirect(303, await this.oauth.complete(query));
    } catch (error) {
      response.redirect(303, this.oauth.errorRedirect(error));
    }
  }
}
