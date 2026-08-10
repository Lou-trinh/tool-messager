import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class SendMessageDto {
  @IsString()
  accountId!: string;

  @IsString()
  contactId!: string;

  @IsString()
  @Length(1, 10_000)
  content!: string;

  @IsOptional()
  @IsBoolean()
  promotional?: boolean;

  @IsString()
  @Length(16, 160)
  idempotencyKey!: string;
}
