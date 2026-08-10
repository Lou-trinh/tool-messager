import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SendMessageDto } from './messages.dto';
import { MessagesService } from './messages.service';

@UseGuards(JwtAuthGuard)
@Controller('workspaces/:workspaceId')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('conversations')
  async conversations(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string): Promise<unknown> { return { success: true, data: await this.messages.conversations(user.id, workspaceId) }; }

  @Get('conversations/:conversationId/messages')
  async history(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Param('conversationId') conversationId: string): Promise<unknown> { return { success: true, data: await this.messages.history(user.id, workspaceId, conversationId) }; }

  @Post('messages')
  async send(@CurrentUser() user: AuthUser, @Param('workspaceId') workspaceId: string, @Body() body: SendMessageDto): Promise<unknown> { return { success: true, data: await this.messages.send(user.id, workspaceId, body) }; }
}
